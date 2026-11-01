import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { allocateSettledTotal } from "@/lib/payments/settlement";
import type { DbExecutor } from "./client";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  type IntegrationEvent,
  integrationDeliveries,
  integrationEvents,
  orderLineItems,
  orders,
  people,
  shopIntegrations,
  tips,
  trips,
} from "./schema";

/**
 * The customer an order event is about.
 *
 * **Stored as an id and nothing else.** `name` and `email` are resolved at
 * delivery time by {@link hydrateIntegrationEventPayload} and never written to
 * `integration_events.payload`, which is kept for 400 days
 * (`RETENTION_DAYS.integration_events`) and which erasure could not scrub even
 * if it tried — the table carries no `person_id` and no index that could find
 * one diver's rows without a full-table JSON scan (issue #1016).
 *
 * The consequence is deliberate and is the better behaviour anyway: a delivery
 * sends whatever `people` says *now*, so an event replayed after an erasure
 * carries the blanked row rather than reproducing a name the diver asked us to
 * forget.
 */
export type OrderIntegrationCustomer = { id: string; name: string; email: string | null };

export type OrderIntegrationPayload = {
  /**
   * What sold (batch 6 item 9, ADR 20261014-checkouts-reach-integrations):
   * a staff `order`, a diver's online booking `checkout`, or a post-dive
   * `tip`. All three travel as `order.*` events in one shape, so every
   * adapter and every shop's existing subscription carries them unchanged.
   * Absent on an event queued before checkouts and tips joined, which was
   * always an order.
   */
  source?: "order" | "checkout" | "tip";
  /** The sold thing's id: an order's, a checkout's or a tip's, by `source`. */
  orderId: string;
  customer: { id: string } | OrderIntegrationCustomer;
  status: string;
  currency: string;
  totalCents: number;
  amountPaidCents: number;
  refundedCents: number;
  refundCents?: number;
  description: string | null;
  createdAt: string;
  lineItems: Array<{
    id: string;
    kind: string;
    description: string;
    quantity: number;
    unitAmountCents: number;
  }>;
};

/**
 * The idempotency keys of the money events, in one place so the live write
 * path and the owner's backfill (`integration-backfill.ts`) can never
 * disagree about what "already sent" means.
 */
export const checkoutPaidKey = (checkoutId: string) => `checkout:${checkoutId}:paid`;
export const checkoutRefundKey = (checkoutId: string, refundedCents: number) =>
  `checkout:${checkoutId}:refund:${refundedCents}`;
export const tipPaidKey = (tipId: string) => `tip:${tipId}:paid`;

/**
 * Fan an event out to one integration only, at a chosen time. The backfill's
 * choice (issue #2606): the owner picked this provider, and another one that
 * has its own closed periods must not hear about it. `nextAttemptAt` is what
 * the queue orders by, so spacing it by a millisecond per event sends oldest
 * first.
 */
export type OnlyIntegration = { id: string; nextAttemptAt: Date };

export function eventIsSubscribed(settings: unknown, eventType: string): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const eventTypes = (settings as { eventTypes?: unknown }).eventTypes;
  return Array.isArray(eventTypes) && eventTypes.includes(eventType);
}

async function loadOrderIntegrationPayload(
  db: DbExecutor,
  shopId: string,
  orderId: string,
  overrides: Partial<
    Pick<OrderIntegrationPayload, "status" | "amountPaidCents" | "refundedCents" | "refundCents">
  > = {},
): Promise<OrderIntegrationPayload | null> {
  const [row] = await db
    .select({ order: orders, person: { id: people.id }, isRehearsal: trips.isRehearsal })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    // An order tied to a seat names that seat's departure; one that is not
    // tied to a seat has no departure to ask about.
    .leftJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    // diveday:allow-rehearsal: read only to refuse; a rehearsal's order never
    // reaches an integration (ADR 20261012-rehearsal-departures). Orders on a
    // rehearsal seat are refused at creation as well, so this is the second wall.
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(orders.shopId, shopId), eq(orders.id, orderId)))
    .limit(1);
  if (!row || row.isRehearsal === true) return null;

  const lineItems = await db
    .select({
      id: orderLineItems.id,
      kind: orderLineItems.kind,
      description: orderLineItems.description,
      quantity: orderLineItems.quantity,
      unitAmountCents: orderLineItems.unitAmountCents,
    })
    .from(orderLineItems)
    .where(and(eq(orderLineItems.shopId, shopId), eq(orderLineItems.orderId, orderId)))
    .orderBy(
      asc(orderLineItems.createdAt),
      asc(orderLineItems.description),
      asc(orderLineItems.id),
    );

  return {
    source: "order",
    orderId: row.order.id,
    // Identity by reference only — see OrderIntegrationCustomer above.
    customer: { id: row.person.id },
    status: overrides.status ?? row.order.status,
    currency: row.order.currency,
    totalCents: row.order.totalCents,
    amountPaidCents: overrides.amountPaidCents ?? row.order.amountPaidCents,
    refundedCents: overrides.refundedCents ?? row.order.refundedCents,
    ...(overrides.refundCents === undefined ? {} : { refundCents: overrides.refundCents }),
    description: row.order.description,
    createdAt: row.order.createdAt.toISOString(),
    lineItems,
  };
}

/** Insert one event and fan it out to currently connected, subscribed providers. */
export async function enqueueIntegrationEvent(
  db: DbExecutor,
  input: {
    shopId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    onlyIntegration?: OnlyIntegration;
  },
): Promise<IntegrationEvent | null> {
  const { onlyIntegration, ...eventValues } = input;
  const [inserted] = await db
    .insert(integrationEvents)
    .values(eventValues)
    .onConflictDoNothing({
      target: [integrationEvents.shopId, integrationEvents.idempotencyKey],
    })
    .returning();
  const event =
    inserted ??
    (
      await db
        .select()
        .from(integrationEvents)
        .where(
          and(
            eq(integrationEvents.shopId, input.shopId),
            eq(integrationEvents.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)
    )[0];
  if (!event) return null;

  const integrations = await db
    .select()
    .from(shopIntegrations)
    .where(
      and(
        eq(shopIntegrations.shopId, input.shopId),
        eq(shopIntegrations.status, "connected"),
        // A disconnect stamps the row rather than deleting it (issue #1015), so
        // "connected" alone would keep queuing orders for a provider the shop
        // took away last month.
        isNull(shopIntegrations.deletedAt),
        ...(onlyIntegration ? [eq(shopIntegrations.id, onlyIntegration.id)] : []),
      ),
    );
  for (const integration of integrations) {
    if (!eventIsSubscribed(integration.settings, input.eventType)) continue;
    await db
      .insert(integrationDeliveries)
      .values({
        shopId: input.shopId,
        integrationId: integration.id,
        eventId: event.id,
        status: "pending",
        ...(onlyIntegration ? { nextAttemptAt: onlyIntegration.nextAttemptAt } : {}),
      })
      .onConflictDoNothing({
        target: [integrationDeliveries.integrationId, integrationDeliveries.eventId],
      });
  }
  return event;
}

export async function enqueueOrderIntegrationEvent(
  db: DbExecutor,
  input: {
    shopId: string;
    orderId: string;
    eventType: "order.created" | "order.paid" | "order.refunded" | "order.voided";
    idempotencyKey: string;
    status?: string;
    amountPaidCents?: number;
    refundedCents?: number;
    refundCents?: number;
  },
): Promise<IntegrationEvent | null> {
  const payload = await loadOrderIntegrationPayload(db, input.shopId, input.orderId, input);
  if (!payload) return null;
  return enqueueIntegrationEvent(db, {
    shopId: input.shopId,
    eventType: input.eventType,
    entityType: "order",
    entityId: input.orderId,
    idempotencyKey: input.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
}

/**
 * **A diver's online booking checkout, as one sale** (batch 6 item 9, H-20261014-checkouts-reach-the-books).
 * One receipt per checkout, never per seat: the party lead paid once, so the
 * books get one sale naming them, with the fare, the gear and the
 * pass-through fees on lines of their own. Tax is not a line, as on an order.
 * Lines are Stripe's settled figure split back across what was asked, so a
 * code's discount lands on every line it discounted and the lines sum to what
 * the shop received, less tax.
 *
 * Null for a checkout that never completed or belongs to a rehearsal
 * departure, which never reaches an integration (ADR
 * 20261012-rehearsal-departures).
 */
async function loadCheckoutIntegrationPayload(
  db: DbExecutor,
  shopId: string,
  checkoutId: string,
  overrides: Partial<Pick<OrderIntegrationPayload, "status" | "refundCents">> = {},
): Promise<OrderIntegrationPayload | null> {
  const [row] = await db
    .select({ checkout: bookingCheckouts, tripTitle: trips.title, isRehearsal: trips.isRehearsal })
    .from(bookingCheckouts)
    // diveday:allow-rehearsal: read only to refuse; a rehearsal's checkout never reaches an integration.
    .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
    .where(and(eq(bookingCheckouts.shopId, shopId), eq(bookingCheckouts.id, checkoutId)))
    .limit(1);
  if (!row || row.isRehearsal || row.checkout.status !== "completed") return null;
  const { checkout } = row;

  const seats = await db
    .select({
      bookingId: bookingCheckoutBookings.bookingId,
      personId: bookings.personId,
      partyLeadBookingId: bookings.partyLeadBookingId,
      createdAt: bookings.createdAt,
      tripCents: bookingCheckoutBookings.tripCents,
      gearCents: bookingCheckoutBookings.gearCents,
      passThroughCents: bookingCheckoutBookings.passThroughCents,
    })
    .from(bookingCheckoutBookings)
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
    )
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        eq(bookingCheckoutBookings.checkoutId, checkoutId),
      ),
    )
    // diveday:allow-time-id-order: the seats are summed into lines nobody sees per seat; order only picks a fallback lead.
    .orderBy(asc(bookings.createdAt), asc(bookings.id));
  // The party lead is the one seat that points at no lead; a checkout of one
  // seat is its own lead either way.
  const lead = seats.find((seat) => seat.partyLeadBookingId === null) ?? seats[0];
  if (!lead) return null;

  const asked = {
    fare: seats.reduce((sum, seat) => sum + (seat.tripCents ?? checkout.amountPerDiverCents), 0),
    gear: seats.reduce((sum, seat) => sum + seat.gearCents, 0),
    passThrough: seats.reduce((sum, seat) => sum + seat.passThroughCents, 0),
  };
  const settledCents = checkout.settledTotalCents ?? checkout.totalCents;
  const netCents = Math.max(0, settledCents - (checkout.taxCents ?? 0));
  const split = allocateSettledTotal(
    [
      { key: "fare", askedCents: asked.fare },
      { key: "gear", askedCents: asked.gear },
      { key: "pass_through", askedCents: asked.passThrough },
    ],
    netCents,
  );
  // Words for an accountant's ledger, not a person's screen: the departure's
  // own title, as the order adapters already write "DiveDay order …".
  const describe: Record<string, string> = {
    fare: checkout.isDeposit ? `${row.tripTitle} (deposit)` : row.tripTitle,
    gear: `${row.tripTitle} (gear)`,
    pass_through: `${row.tripTitle} (fees collected for others)`,
  };
  const lineItems = (["fare", "gear", "pass_through"] as const).flatMap((kind) => {
    const cents = split.get(kind) ?? 0;
    return cents > 0
      ? [
          {
            id: `${checkoutId}:${kind}`,
            kind: kind === "fare" && checkout.isDeposit ? "deposit" : kind,
            description: describe[kind] ?? row.tripTitle,
            quantity: 1,
            unitAmountCents: cents,
          },
        ]
      : [];
  });

  return {
    source: "checkout",
    orderId: checkout.id,
    customer: { id: lead.personId },
    status: overrides.status ?? (checkout.refundedCents > 0 ? "partly_refunded" : "paid"),
    currency: checkout.currency,
    totalCents: settledCents,
    amountPaidCents: settledCents,
    refundedCents: checkout.refundedCents,
    ...(overrides.refundCents === undefined ? {} : { refundCents: overrides.refundCents }),
    description: row.tripTitle,
    createdAt: (checkout.completedAt ?? checkout.createdAt).toISOString(),
    lineItems,
  };
}

/** A completed checkout's sale (`order.paid`) or one refund against it (`order.refunded`). */
export async function enqueueCheckoutIntegrationEvent(
  db: DbExecutor,
  input: {
    shopId: string;
    checkoutId: string;
    eventType: "order.paid" | "order.refunded";
    idempotencyKey: string;
    status?: string;
    refundCents?: number;
    onlyIntegration?: OnlyIntegration;
  },
): Promise<IntegrationEvent | null> {
  const payload = await loadCheckoutIntegrationPayload(db, input.shopId, input.checkoutId, {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.refundCents === undefined ? {} : { refundCents: input.refundCents }),
  });
  if (!payload) return null;
  return enqueueIntegrationEvent(db, {
    shopId: input.shopId,
    eventType: input.eventType,
    entityType: "checkout",
    entityId: input.checkoutId,
    idempotencyKey: input.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
    ...(input.onlyIntegration ? { onlyIntegration: input.onlyIntegration } : {}),
  });
}

/**
 * **A post-dive tip, as a sale of its own** (batch 6 item 9, H-20261014-checkouts-reach-the-books): income
 * on one line, named as a tip, from the diver who left it. A tip has its own
 * Stripe checkout, days after the booking's, so it is its own receipt rather
 * than a line added to a sale the books already closed.
 */
export async function enqueueTipIntegrationEvent(
  db: DbExecutor,
  input: { shopId: string; tipId: string; onlyIntegration?: OnlyIntegration },
): Promise<IntegrationEvent | null> {
  const [row] = await db
    .select({
      tip: tips,
      personId: bookings.personId,
      tripTitle: trips.title,
      isRehearsal: trips.isRehearsal,
    })
    .from(tips)
    .innerJoin(bookings, and(eq(bookings.id, tips.bookingId), eq(bookings.shopId, input.shopId)))
    // diveday:allow-rehearsal: read only to refuse; a rehearsal's tip never reaches an integration.
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
    .where(and(eq(tips.shopId, input.shopId), eq(tips.id, input.tipId)))
    .limit(1);
  if (!row || row.isRehearsal || row.tip.status !== "paid") return null;
  const payload: OrderIntegrationPayload = {
    source: "tip",
    orderId: row.tip.id,
    customer: { id: row.personId },
    status: "paid",
    currency: row.tip.currency,
    totalCents: row.tip.amountCents,
    amountPaidCents: row.tip.amountCents,
    refundedCents: 0,
    description: row.tripTitle,
    createdAt: (row.tip.completedAt ?? row.tip.createdAt).toISOString(),
    lineItems: [
      {
        id: `${row.tip.id}:tip`,
        kind: "tip",
        description: `Tip: ${row.tripTitle}`,
        quantity: 1,
        unitAmountCents: row.tip.amountCents,
      },
    ],
  };
  return enqueueIntegrationEvent(db, {
    shopId: input.shopId,
    eventType: "order.paid",
    entityType: "tip",
    entityId: row.tip.id,
    idempotencyKey: tipPaidKey(row.tip.id),
    payload: payload as unknown as Record<string, unknown>,
    ...(input.onlyIntegration ? { onlyIntegration: input.onlyIntegration } : {}),
  });
}

/**
 * Whether an order already has an event of this type queued.
 *
 * The accounting adapters ask it before booking a sale: an `order.voided`
 * delivered while the `order.paid` before it was still retrying found nothing
 * to undo, so the sale must never be booked after it (issue #2309).
 */
export async function orderHasIntegrationEvent(
  db: DbExecutor,
  input: { shopId: string; orderId: string; eventType: "order.voided" },
): Promise<boolean> {
  const [found] = await db
    .select({ id: integrationEvents.id })
    .from(integrationEvents)
    .where(
      and(
        eq(integrationEvents.shopId, input.shopId),
        eq(integrationEvents.entityType, "order"),
        eq(integrationEvents.entityId, input.orderId),
        eq(integrationEvents.eventType, input.eventType),
      ),
    )
    .limit(1);
  return Boolean(found);
}

/**
 * Fill in the identity the stored payload deliberately does not hold.
 *
 * Called once per delivery, in the dispatcher, so every adapter receives the
 * same hydrated event and no adapter has to know the payload is a reference
 * rather than a copy. A diver whose record was erased comes back as the blanked
 * row says — the anonymized name and a null email — which is exactly what a
 * delivery after an erasure should carry.
 *
 * A person row that cannot be found at all leaves `customer` as the bare id.
 * That is not an error path worth failing a delivery over: the order's owner is
 * an `innerJoin` at enqueue time and `people` rows are never hard-deleted, so
 * the only way here is a shop purge that is taking the event with it anyway.
 */
export async function hydrateIntegrationEventPayload(
  db: DbExecutor,
  event: IntegrationEvent,
): Promise<IntegrationEvent> {
  const payload = event.payload;
  const customer = (payload as { customer?: unknown }).customer;
  if (!customer || typeof customer !== "object" || Array.isArray(customer)) return event;
  const personId = (customer as { id?: unknown }).id;
  if (typeof personId !== "string") return event;

  const [person] = await db
    .select({ fullName: people.fullName, email: people.email })
    .from(people)
    // diveday:allow-deleted-people: the event describes the person as they were when it happened.
    .where(and(eq(people.id, personId), eq(people.shopId, event.shopId)))
    .limit(1);
  if (!person) return event;
  return {
    ...event,
    payload: {
      ...payload,
      customer: { id: personId, name: person.fullName, email: person.email },
    },
  };
}

/**
 * Which end of the due set to take when `limit` bites.
 *
 * `oldest-first` is the drain's own fairness: the row that has waited longest
 * goes next, which is what a backlog pass owes the rows in it.
 *
 * `newest-first` exists for the write path, and the difference is not a
 * preference but a correctness property. A freshly enqueued delivery gets
 * `next_attempt_at = now()`, and every *other* due row is due precisely because
 * its own `next_attempt_at` already passed — so among due rows the new one is
 * always the maximum. Taking the oldest end meant a shop with `limit` or more
 * waiting deliveries drained those and left the order just written for the
 * cron, which is exactly the latency the write path exists to remove, failing
 * silently at the moment a shop is most likely watching for it
 * (`sourcery-ai` on #1905). Taking the newest end makes "the thing I just
 * wrote is in this batch" true by construction rather than by luck.
 *
 * The backlog is not starved by this: the cron still runs `oldest-first` every
 * half hour and is the pass that owes old rows their turn.
 */
export type DueDeliveryOrder = "oldest-first" | "newest-first";

export async function listDueIntegrationDeliveries(
  db: DbExecutor,
  limit = 25,
  order: DueDeliveryOrder = "oldest-first",
) {
  const current = nowDate();
  const staleProcessingBefore = new Date(current.getTime() - 15 * 60 * 1000);
  return db
    .select({
      delivery: integrationDeliveries,
      event: integrationEvents,
      integration: shopIntegrations,
    })
    .from(integrationDeliveries)
    .innerJoin(integrationEvents, eq(integrationEvents.id, integrationDeliveries.eventId))
    .innerJoin(shopIntegrations, eq(shopIntegrations.id, integrationDeliveries.integrationId))
    .where(
      and(
        or(
          and(
            inArray(integrationDeliveries.status, ["pending", "failed"]),
            lt(integrationDeliveries.attemptCount, 8),
            lte(integrationDeliveries.nextAttemptAt, current),
          ),
          and(
            eq(integrationDeliveries.status, "processing"),
            lt(integrationDeliveries.updatedAt, staleProcessingBefore),
          ),
        ),
        eq(shopIntegrations.status, "connected"),
        isNull(shopIntegrations.deletedAt),
      ),
    )
    .orderBy(
      ...(order === "newest-first"
        ? [desc(integrationDeliveries.nextAttemptAt), desc(integrationDeliveries.createdAt)]
        : [asc(integrationDeliveries.nextAttemptAt), asc(integrationDeliveries.createdAt)]),
    )
    .limit(limit);
}

/** Claim is a conditional update: two cron workers can select the same row, but only one wins. */
export async function claimIntegrationDelivery(db: DbExecutor, deliveryId: string) {
  const now = nowDate();
  const staleProcessingBefore = new Date(now.getTime() - 15 * 60 * 1000);
  const [row] = await db
    .update(integrationDeliveries)
    .set({
      status: "processing",
      attemptCount: sql`${integrationDeliveries.attemptCount} + 1`,
      updatedAt: now,
      lastError: null,
    })
    .where(
      and(
        eq(integrationDeliveries.id, deliveryId),
        or(
          and(
            inArray(integrationDeliveries.status, ["pending", "failed"]),
            lt(integrationDeliveries.attemptCount, 8),
            lte(integrationDeliveries.nextAttemptAt, now),
          ),
          and(
            eq(integrationDeliveries.status, "processing"),
            lt(integrationDeliveries.updatedAt, staleProcessingBefore),
          ),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

export async function markIntegrationDeliveryDelivered(
  db: DbExecutor,
  deliveryId: string,
): Promise<void> {
  const now = nowDate();
  await db
    .update(integrationDeliveries)
    .set({ status: "delivered", deliveredAt: now, updatedAt: now, lastError: null })
    .where(eq(integrationDeliveries.id, deliveryId));
}

export async function markIntegrationDeliveryFailed(
  db: DbExecutor,
  input: { deliveryId: string; attemptCount: number; errorCode: string; retryable: boolean },
): Promise<void> {
  const now = nowDate();
  const shouldRetry = input.retryable && input.attemptCount < 8;
  const backoffMinutes = Math.min(60, 2 ** Math.max(0, input.attemptCount - 1));
  await db
    .update(integrationDeliveries)
    .set({
      status: shouldRetry ? "pending" : "failed",
      nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60 * 1000),
      updatedAt: now,
      lastError: input.errorCode.slice(0, 200),
    })
    .where(eq(integrationDeliveries.id, input.deliveryId));
}
