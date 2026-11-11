import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { canPersonRefund, loadActiveStaffRoles } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { recordOrderCollection } from "../../db/collection-ledger";
import { enqueueOrderIntegrationEvent } from "../../db/integration-events";
import {
  listOrderableCustomers,
  type NewCounterOrderInput,
  recordCounterOrder,
} from "../../db/orders";
import { activityEvents, orders, people } from "../../db/schema";
import { getShopCurrency } from "../../db/stripe-accounts";
import { isStaff } from "../../lib/authz";
import { nowDate } from "../../lib/clock";
import { isUuid } from "../../lib/uuid";
import { remainingCounterReceipt } from "./rules";

/** Local receipt recording never creates a payment, invoice, email or card request. */
export async function recordPurchase(
  db: AppDb,
  input: NewCounterOrderInput & { attemptId: string; currency: string },
) {
  if (!isUuid(input.attemptId) || input.currency !== (await getShopCurrency(db, input.shopId))) {
    return { ok: false, reason: "invalid" } as const;
  }
  return recordCounterOrder(db, input);
}

/** Recording belongs to every live staff role, independently of Stripe setup. */
export async function getPurchaseForm(db: AppDb, shopId: string, personId: string) {
  const roles = await loadActiveStaffRoles(db, shopId, personId);
  if (!roles || !isStaff(roles)) return null;
  const [customers, currency] = await Promise.all([
    listOrderableCustomers(db, shopId),
    getShopCurrency(db, shopId),
  ]);
  return { customers, currency };
}

type RefundInput = {
  shopId: string;
  orderId: string;
  actorPersonId: string;
  attemptId: string;
  amountCents: number;
  currency: string;
  expectedRefundedCents: number;
  reason: string;
};

/**
 * Record money ALREADY returned outside DiveDay. No provider refund call.
 * The receipt lock serializes partial refunds; expected totals refuse stale
 * forms, and the immutable activity UUID makes replay a no-op. Original
 * tax/tip/levy proportions remain fixed, including a wholly excluded receipt.
 */
export async function recordPurchaseRefund(db: AppDb, input: RefundInput) {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (
    ![input.orderId, input.attemptId].every(isUuid) ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    !Number.isSafeInteger(input.expectedRefundedCents) ||
    input.expectedRefundedCents < 0 ||
    !input.reason.trim() ||
    input.reason.length > 200
  )
    return invalid;
  if (!(await canPersonRefund(db, input.shopId, input.actorPersonId)))
    return { ok: false, reason: "not_authorized" } as const;
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)))
      .for("update");
    if (
      !order ||
      order.stripeInvoiceId !== null ||
      order.collection === "stripe_invoice" ||
      order.bookingId !== null ||
      order.currency !== input.currency ||
      !order.counterReceipt
    )
      return invalid;
    const [replay] = await tx
      .select()
      .from(activityEvents)
      // diveday:allow-staff-events: staff-only refund replay identity, never diver content.
      .where(and(eq(activityEvents.id, input.attemptId), eq(activityEvents.shopId, input.shopId)));
    if (replay)
      return replay.shopId === input.shopId &&
        replay.orderId === order.id &&
        replay.actorPersonId === input.actorPersonId &&
        replay.params.amountCents === String(input.amountCents) &&
        replay.params.reason === input.reason.trim()
        ? ({ ok: true, order } as const)
        : invalid;
    if (
      !["paid", "partly_refunded"].includes(order.status) ||
      order.refundedCents !== input.expectedRefundedCents ||
      input.amountCents > order.amountPaidCents
    )
      return invalid;
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(
        and(
          eq(people.id, input.actorPersonId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      );
    if (!actor) return invalid;
    const [event] = await tx
      .insert(activityEvents)
      .values({
        id: input.attemptId,
        shopId: input.shopId,
        orderId: order.id,
        actorPersonId: input.actorPersonId,
        subjectPersonId: order.personId,
        code: "order_refunded",
        audience: "staff",
        params: {
          actor: actor.name,
          amountCents: String(input.amountCents),
          currency: order.currency,
          reason: input.reason.trim(),
          purchaseRefund: "true",
        },
      })
      .onConflictDoNothing({ target: activityEvents.id })
      .returning({ id: activityEvents.id });
    // Another receipt used this request UUID. No money write has happened.
    if (!event) return invalid;
    const amountPaidCents = order.amountPaidCents - input.amountCents;
    const remaining = remainingCounterReceipt(
      order.counterReceipt,
      order.totalCents,
      amountPaidCents,
    );
    const now = nowDate();
    const [updated] = await tx
      .update(orders)
      .set({
        status: amountPaidCents === 0 ? "refunded" : "partly_refunded",
        amountPaidCents,
        refundedCents: order.refundedCents + input.amountCents,
        taxCents: remaining.taxCents,
        tipCents: remaining.tipCents,
        passThroughCents: remaining.passThroughCents,
        refundedAt: order.refundedAt ?? now,
        updatedAt: now,
      })
      .where(and(eq(orders.id, order.id), eq(orders.shopId, input.shopId)))
      .returning();
    if (!updated) throw new Error("purchase_refund_missing_order");
    await recordOrderCollection(tx, input.shopId, order.id);
    await enqueueOrderIntegrationEvent(tx, {
      shopId: input.shopId,
      orderId: order.id,
      eventType: "order.refunded",
      idempotencyKey: `order:${order.id}:external-refund:${input.attemptId}`,
      status: updated.status,
      amountPaidCents,
      refundedCents: updated.refundedCents,
      refundCents: input.amountCents,
    });
    return { ok: true, order: updated } as const;
  });
}

/** Existing shop activity retention/erasure rules also govern this refund history. */
export async function purchaseRefundHistory(db: AppDb, shopId: string, orderId: string) {
  // diveday:allow-staff-events: the staff receipt page reads its own refund audit trail.
  return (
    db
      .select({
        id: activityEvents.id,
        at: activityEvents.occurredAt,
        params: activityEvents.params,
        actorName: people.fullName,
      })
      .from(activityEvents)
      // diveday:allow-staff-events: staff-only receipt refund history.
      .leftJoin(people, and(eq(people.id, activityEvents.actorPersonId), eq(people.shopId, shopId)))
      .where(
        and(
          eq(activityEvents.shopId, shopId),
          eq(activityEvents.orderId, orderId),
          eq(activityEvents.code, "order_refunded"),
          sql`${activityEvents.params}->>'purchaseRefund' = 'true'`,
        ),
      )
      .orderBy(desc(activityEvents.seq))
      .limit(50)
  );
}
