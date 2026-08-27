import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import {
  type IntegrationEvent,
  integrationConnectionStatus,
  integrationDeliveries,
  integrationDeliveryStatus,
  integrationEvents,
  integrationProvider,
  orderLineItems,
  orders,
  people,
  shopIntegrations,
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

function eventIsSubscribed(settings: unknown, eventType: string): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const eventTypes = (settings as { eventTypes?: unknown }).eventTypes;
  return Array.isArray(eventTypes) && eventTypes.includes(eventType);
}

export async function loadOrderIntegrationPayload(
  db: DbExecutor,
  shopId: string,
  orderId: string,
  overrides: Partial<
    Pick<OrderIntegrationPayload, "status" | "amountPaidCents" | "refundedCents" | "refundCents">
  > = {},
): Promise<OrderIntegrationPayload | null> {
  const [row] = await db
    .select({ order: orders, person: { id: people.id } })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .where(and(eq(orders.shopId, shopId), eq(orders.id, orderId)))
    .limit(1);
  if (!row) return null;

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
    .orderBy(asc(orderLineItems.createdAt), asc(orderLineItems.id));

  return {
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
  },
): Promise<IntegrationEvent | null> {
  const [inserted] = await db
    .insert(integrationEvents)
    .values(input)
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
    eventType: "order.created" | "order.paid" | "order.refunded";
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

export async function listDueIntegrationDeliveries(db: DbExecutor, limit = 25) {
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
    .orderBy(asc(integrationDeliveries.nextAttemptAt), asc(integrationDeliveries.createdAt))
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

export const integrationProviderEnum = integrationProvider.enumValues;
export const integrationConnectionStatusEnum = integrationConnectionStatus.enumValues;
export const integrationDeliveryStatusEnum = integrationDeliveryStatus.enumValues;
