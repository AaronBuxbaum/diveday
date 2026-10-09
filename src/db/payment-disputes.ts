import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PaymentSourceLookup } from "@/lib/payments/payment-sources";
import type { AppDb } from "./client";
import type { PaymentDispute } from "./schema";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  orders,
  paymentDisputes,
  people,
  trips,
} from "./schema";
import { findStripePaymentTarget } from "./stripe-payment-targets";

/**
 * Stripe's dispute statuses that mean the bank has decided, or the inquiry is
 * over. Anything else — including a status Stripe adds later — reads as still
 * open, which is the direction to fail: an owner shown a decided dispute
 * checks Stripe and finds it closed; one never shown an open dispute misses
 * the evidence deadline and loses the money.
 */
const CLOSED_DISPUTE_STATUSES: ReadonlySet<string> = new Set([
  "won",
  "lost",
  "warning_closed",
  "prevented",
]);

export type DisputeEvent = {
  /** The event's own `account`. */
  stripeAccountId: string;
  /** Stripe's event `type`: `charge.dispute.created`, `.updated` or `.closed`. */
  eventType: string;
  /** The event's `created` time — the ordering key, never delivery order. */
  occurredAt: Date;
  dispute: {
    id: string;
    paymentIntentId: string;
    amountCents: number;
    currency: string;
    reason: string | null;
    status: string;
    evidenceDueBy: Date | null;
    createdAt: Date;
  };
};

export type DisputeOutcome =
  | { status: "recorded"; dispute: PaymentDispute }
  /** An older event than one already applied — nothing written. */
  | { status: "stale" }
  /** A charge DiveDay never raised; not DiveDay's to show. */
  | { status: "not_found" };

/**
 * **Record a card dispute against the order or checkout it is about** (ADR
 * 20261009-stripe-reversals-reach-diveday), from any `charge.dispute.*` event.
 *
 * One row per Stripe dispute, upserted. Ordered by the event's `created` time
 * under the row's own conflict target: an `updated` that Stripe delivers after
 * the `closed` it preceded never reopens the dispute, and a replay changes
 * nothing. `closed_at` keeps the first close it saw.
 *
 * Informs; never moves money and never touches the order's balance or a seat's
 * payment. A lost dispute is money Stripe has taken back, and the shop sees it
 * where Stripe shows it.
 */
export async function recordStripeDispute(
  db: AppDb,
  event: DisputeEvent,
  lookup?: PaymentSourceLookup,
): Promise<DisputeOutcome> {
  const target = await findStripePaymentTarget(
    db,
    { stripeAccountId: event.stripeAccountId, paymentIntentId: event.dispute.paymentIntentId },
    lookup,
  );
  if (target.kind === "none") return { status: "not_found" };
  const shopId = target.kind === "order" ? target.order.shopId : target.checkout.shopId;

  const closed =
    event.eventType === "charge.dispute.closed" ||
    CLOSED_DISPUTE_STATUSES.has(event.dispute.status);
  const row = {
    shopId,
    stripeAccountId: event.stripeAccountId,
    stripeDisputeId: event.dispute.id,
    stripePaymentIntentId: event.dispute.paymentIntentId,
    orderId: target.kind === "order" ? target.order.id : null,
    checkoutId: target.kind === "checkout" ? target.checkout.id : null,
    amountCents: event.dispute.amountCents,
    currency: event.dispute.currency,
    reason: event.dispute.reason,
    status: event.dispute.status,
    evidenceDueBy: event.dispute.evidenceDueBy,
    openedAt: event.dispute.createdAt,
    closedAt: closed ? event.occurredAt : null,
    lastEventAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
  const [written] = await db
    .insert(paymentDisputes)
    .values(row)
    .onConflictDoUpdate({
      target: paymentDisputes.stripeDisputeId,
      set: {
        amountCents: row.amountCents,
        reason: row.reason,
        status: row.status,
        evidenceDueBy: row.evidenceDueBy,
        // Cleared only by a strictly newer event (the guard below refuses an
        // equal-time update to a closed row), so a close is never undone by
        // an `updated` Stripe stamped in the same second.
        closedAt: closed ? sql`coalesce(${paymentDisputes.closedAt}, ${row.closedAt})` : sql`null`,
        lastEventAt: row.lastEventAt,
        updatedAt: row.updatedAt,
      },
      // Never let an older event overwrite a newer one, and never let a row
      // move to another shop's account: the dispute id is Stripe's, but the
      // account is the event's own statement of whose it is.
      //
      // Same-second events are ambiguous — Stripe's `created` has one-second
      // resolution — so an equal time may only *close* a dispute or touch one
      // still open; it never reopens one already decided.
      setWhere: and(
        closed
          ? sql`${paymentDisputes.lastEventAt} <= ${row.lastEventAt}`
          : sql`(${paymentDisputes.lastEventAt} < ${row.lastEventAt} or (${paymentDisputes.lastEventAt} = ${row.lastEventAt} and ${paymentDisputes.closedAt} is null))`,
        eq(paymentDisputes.stripeAccountId, row.stripeAccountId),
      ),
    })
    .returning();
  return written ? { status: "recorded", dispute: written } : { status: "stale" };
}

/** One undecided dispute, as Today and the order page show it. */
export type OpenPaymentDispute = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  evidenceDueBy: Date | null;
  orderId: string | null;
  /** The departure a checkout's seats were on; null for an order. */
  tripId: string | null;
  tripTitle: string | null;
  /** The order's customer, or the first diver on a checkout. */
  personName: string | null;
};

/**
 * A shop's undecided disputes, soonest evidence deadline first (a dispute
 * with no deadline last). Bounded like every other back-office read.
 */
export async function listOpenPaymentDisputes(
  db: AppDb,
  shopId: string,
  options: { orderId?: string; limit?: number } = {},
): Promise<OpenPaymentDispute[]> {
  const rows = await db
    .select({
      dispute: paymentDisputes,
      orderPersonName: people.fullName,
      checkoutTripId: bookingCheckouts.tripId,
    })
    .from(paymentDisputes)
    .leftJoin(
      orders,
      and(eq(orders.id, paymentDisputes.orderId), eq(orders.shopId, paymentDisputes.shopId)),
    )
    .leftJoin(people, and(eq(people.id, orders.personId), eq(people.shopId, shopId)))
    .leftJoin(
      bookingCheckouts,
      and(
        eq(bookingCheckouts.id, paymentDisputes.checkoutId),
        eq(bookingCheckouts.shopId, paymentDisputes.shopId),
      ),
    )
    .where(
      and(
        eq(paymentDisputes.shopId, shopId),
        isNull(paymentDisputes.closedAt),
        ...(options.orderId ? [eq(paymentDisputes.orderId, options.orderId)] : []),
      ),
    )
    .orderBy(sql`${paymentDisputes.evidenceDueBy} asc nulls last`, asc(paymentDisputes.openedAt))
    .limit(options.limit ?? 50);

  // The trip and a diver's name for checkout disputes, batched: a checkout
  // covers a party, and the first seat's diver is the name a desk recognizes.
  const checkoutIds = rows.flatMap((row) =>
    row.dispute.checkoutId ? [row.dispute.checkoutId] : [],
  );
  const tripIds = rows.flatMap((row) => (row.checkoutTripId ? [row.checkoutTripId] : []));
  const [divers, tripRows] = await Promise.all([
    checkoutIds.length === 0
      ? []
      : db
          .select({
            checkoutId: bookingCheckoutBookings.checkoutId,
            fullName: people.fullName,
          })
          .from(bookingCheckoutBookings)
          .innerJoin(
            bookings,
            and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
          )
          .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
          .where(
            and(
              eq(bookingCheckoutBookings.shopId, shopId),
              inArray(bookingCheckoutBookings.checkoutId, checkoutIds),
            ),
          )
          .orderBy(asc(bookingCheckoutBookings.id)),
    tripIds.length === 0
      ? []
      : db
          .select({ id: trips.id, title: trips.title })
          .from(trips)
          // diveday:allow-deleted-trips: a dispute on a departure since deleted is still money in question, and still needs its name.
          .where(and(eq(trips.shopId, shopId), inArray(trips.id, tripIds))),
  ]);
  const diverByCheckout = new Map<string, string>();
  for (const diver of divers) {
    if (!diverByCheckout.has(diver.checkoutId))
      diverByCheckout.set(diver.checkoutId, diver.fullName);
  }
  const titleByTrip = new Map(tripRows.map((trip) => [trip.id, trip.title]));

  return rows.map(({ dispute, orderPersonName, checkoutTripId }) => ({
    id: dispute.id,
    amountCents: dispute.amountCents,
    currency: dispute.currency,
    status: dispute.status,
    evidenceDueBy: dispute.evidenceDueBy,
    orderId: dispute.orderId,
    tripId: checkoutTripId,
    tripTitle: checkoutTripId ? (titleByTrip.get(checkoutTripId) ?? null) : null,
    personName: dispute.checkoutId
      ? (diverByCheckout.get(dispute.checkoutId) ?? null)
      : orderPersonName,
  }));
}
