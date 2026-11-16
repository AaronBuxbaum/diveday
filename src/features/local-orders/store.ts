import { and, eq, isNull } from "drizzle-orm";
import { canPersonManageOrders, loadActiveStaffRoles } from "../../db/authz";
import type { AppDb, DbExecutor } from "../../db/client";
import { recordOrderCollection } from "../../db/collection-ledger";
import { enqueueOrderIntegrationEvent } from "../../db/integration-events";
import { boundLockWaits, isLockWaitRefusal } from "../../db/lock-bounds";
import type { NewOrderLineItem } from "../../db/orders";
import { activityEvents, orderLineItems, orders, people, shops } from "../../db/schema";
import { getShopCurrency } from "../../db/stripe-accounts";
import { isStaff } from "../../lib/authz";
import { nowDate } from "../../lib/clock";
import {
  ancillaryFingerprint,
  ancillaryTotals,
  RECEIPT_METHODS,
  type ReceiptMethod,
} from "../../lib/purchase-lines";
import { isUuid } from "../../lib/uuid";

const invalid = { ok: false, reason: "invalid" } as const;
class AttemptConflict extends Error {}
async function activePayer(tx: DbExecutor, shopId: string, personId: string) {
  await boundLockWaits(tx);
  const [payer] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.shopId, shopId), isNull(people.deletedAt)))
    .for("no key update");
  return payer;
}
function refusal(error: unknown) {
  if (error instanceof AttemptConflict || isLockWaitRefusal(error)) return invalid;
  throw error;
}

/** A named ancillary balance, never a booking fare, provider invoice or payment. */
export async function createLocalOrder(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    actorPersonId: string;
    attemptId: string;
    currency: string;
    lineItems: NewOrderLineItem[];
    description?: string | null;
  },
) {
  if (
    ![input.shopId, input.personId, input.actorPersonId, input.attemptId].every(isUuid) ||
    (input.description?.length ?? 0) > 200 ||
    input.currency !== (await getShopCurrency(db, input.shopId))
  )
    return invalid;
  const totals = ancillaryTotals(input.lineItems, input.currency);
  if (!totals || totals.totalCents <= 0) return invalid;
  return db
    .transaction(async (tx) => {
      await boundLockWaits(tx);
      if (
        !(await canPersonManageOrders(tx, input.shopId, input.actorPersonId)) ||
        !(await activePayer(tx, input.shopId, input.personId))
      )
        return invalid;
      // Check authority and currency after the payer wait, while preventing a
      // currency edit from racing the new native-currency debt.
      const [shop] = await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.id, input.shopId))
        .for("share", { noWait: true });
      if (
        !shop ||
        input.currency !== (await getShopCurrency(tx, input.shopId)) ||
        !(await canPersonManageOrders(tx, input.shopId, input.actorPersonId))
      )
        return invalid;
      const [created] = await tx
        .insert(orders)
        .values({
          id: input.attemptId,
          shopId: input.shopId,
          personId: input.personId,
          bookingId: null,
          createdByPersonId: input.actorPersonId,
          source: "staff",
          status: "open",
          collection: "local_invoice",
          currency: input.currency,
          ...totals,
          amountPaidCents: 0,
          taxCents: 0,
          tipCents: 0,
          description: input.description?.trim() || null,
          stripeAccountId: null,
          stripeCustomerId: null,
          stripeInvoiceId: null,
          stripePaymentIntentId: null,
          finalizedAt: nowDate(),
        })
        .onConflictDoNothing({ target: orders.id })
        .returning();
      if (!created) {
        const [existing] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, input.attemptId), eq(orders.shopId, input.shopId)));
        const [intent] = await tx
          .select()
          .from(activityEvents)
          // diveday:allow-staff-events: local creation replay requires its original staff-only intent.
          .where(
            and(
              eq(activityEvents.id, input.attemptId),
              eq(activityEvents.shopId, input.shopId),
              eq(activityEvents.orderId, input.attemptId),
              eq(activityEvents.code, "local_order_opened"),
            ),
          );
        if (
          !existing ||
          !intent ||
          intent.params.localOrder !== "true" ||
          existing.personId !== input.personId ||
          existing.createdByPersonId !== input.actorPersonId ||
          existing.currency !== input.currency ||
          existing.totalCents !== totals.totalCents ||
          existing.description !== (input.description?.trim() || null)
        )
          return invalid;
        const lines = await tx
          .select()
          .from(orderLineItems)
          .where(
            and(eq(orderLineItems.orderId, existing.id), eq(orderLineItems.shopId, input.shopId)),
          );
        return ancillaryFingerprint(lines) === ancillaryFingerprint(input.lineItems)
          ? { ok: true as const, order: existing }
          : invalid;
      }
      await tx.insert(orderLineItems).values(
        input.lineItems.map((item) => ({
          ...item,
          shopId: input.shopId,
          orderId: created.id,
          packageId: null,
        })),
      );
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
      const event = await tx
        .insert(activityEvents)
        .values({
          id: input.attemptId,
          shopId: input.shopId,
          orderId: created.id,
          actorPersonId: input.actorPersonId,
          subjectPersonId: input.personId,
          code: "local_order_opened",
          audience: "staff",
          params: { actor: actor?.name ?? "", localOrder: "true" },
        })
        .onConflictDoNothing()
        .returning({ id: activityEvents.id });
      if (!event.length) throw new AttemptConflict();
      return { ok: true as const, order: created };
    })
    .catch(refusal);
}

/** Record the full amount ALREADY received elsewhere. Does not contact a provider or clear a fare. */
export async function recordLocalOrderReceipt(
  db: AppDb,
  input: {
    shopId: string;
    orderId: string;
    actorPersonId: string;
    attemptId: string;
    expectedTotalCents: number;
    currency: string;
    collection: ReceiptMethod;
    taxCents?: number;
    tipCents: number;
    receiptReference: string | null;
  },
) {
  if (
    ![input.shopId, input.orderId, input.actorPersonId, input.attemptId].every(isUuid) ||
    !RECEIPT_METHODS.includes(input.collection) ||
    !Number.isSafeInteger(input.expectedTotalCents) ||
    (input.receiptReference?.length ?? 0) > 100 ||
    ![input.taxCents ?? 0, input.tipCents].every(
      (amount) => Number.isSafeInteger(amount) && amount >= 0,
    )
  )
    return invalid;
  return db
    .transaction(async (tx) => {
      await boundLockWaits(tx);
      const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
      if (!roles || !isStaff(roles)) return invalid;
      const [scope] = await tx
        .select({ personId: orders.personId })
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)));
      if (!scope?.personId || !(await activePayer(tx, input.shopId, scope.personId)))
        return invalid;
      const [order] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)))
        .for("update");
      if (
        !order ||
        order.personId !== scope.personId ||
        order.bookingId !== null ||
        order.stripeAccountId !== null ||
        order.stripeInvoiceId !== null ||
        order.stripeCustomerId !== null ||
        order.stripePaymentIntentId !== null ||
        order.currency !== input.currency ||
        order.totalCents !== input.expectedTotalCents
      )
        return invalid;
      const currentRoles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
      if (!currentRoles || !isStaff(currentRoles)) return invalid;
      const [replay] = await tx
        .select()
        .from(activityEvents)
        // diveday:allow-staff-events: receipt replay identity, never diver content.
        .where(
          and(eq(activityEvents.id, input.attemptId), eq(activityEvents.shopId, input.shopId)),
        );
      const reference = input.receiptReference?.trim() || null;
      if (replay)
        return replay.orderId === order.id &&
          replay.actorPersonId === input.actorPersonId &&
          replay.code === "purchase_recorded" &&
          order.collection === input.collection &&
          order.counterReceipt?.taxCents === (input.taxCents ?? 0) &&
          order.counterReceipt?.taxKnown === (input.taxCents !== undefined) &&
          order.counterReceipt?.tipCents === input.tipCents &&
          order.counterReceipt?.reference === reference
          ? { ok: true as const, order }
          : invalid;
      if (
        order.collection !== "local_invoice" ||
        order.status !== "open" ||
        order.amountPaidCents !== 0 ||
        order.counterReceipt ||
        (input.taxCents ?? 0) + input.tipCents + order.passThroughCents > order.totalCents
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
      const event = await tx
        .insert(activityEvents)
        .values({
          id: input.attemptId,
          shopId: input.shopId,
          orderId: order.id,
          actorPersonId: input.actorPersonId,
          subjectPersonId: order.personId,
          code: "purchase_recorded",
          audience: "staff",
          params: {
            actor: actor?.name ?? "",
            amountCents: String(order.totalCents),
            currency: order.currency,
            method: input.collection,
            localOrder: "true",
          },
        })
        .onConflictDoNothing()
        .returning({ id: activityEvents.id });
      if (!event.length) return invalid;
      const [paid] = await tx
        .update(orders)
        .set({
          status: "paid",
          collection: input.collection,
          amountPaidCents: order.totalCents,
          taxCents: input.taxCents ?? 0,
          tipCents: input.tipCents,
          counterReceipt: {
            taxCents: input.taxCents ?? 0,
            taxKnown: input.taxCents !== undefined,
            tipCents: input.tipCents,
            passThroughCents: order.passThroughCents,
            reference,
          },
          paidAt: nowDate(),
          updatedAt: nowDate(),
        })
        .where(and(eq(orders.id, order.id), eq(orders.shopId, input.shopId)))
        .returning();
      await recordOrderCollection(tx, input.shopId, order.id);
      await enqueueOrderIntegrationEvent(tx, {
        shopId: input.shopId,
        orderId: order.id,
        eventType: "order.paid",
        idempotencyKey: `order:${order.id}:paid`,
        status: paid.status,
        amountPaidCents: paid.amountPaidCents,
        refundedCents: paid.refundedCents,
      });
      return { ok: true as const, order: paid };
    })
    .catch(refusal);
}

export async function voidLocalOrder(
  db: AppDb,
  input: { shopId: string; orderId: string; actorPersonId: string },
) {
  if (![input.shopId, input.orderId, input.actorPersonId].every(isUuid)) return invalid;
  return db
    .transaction(async (tx) => {
      await boundLockWaits(tx);
      if (!(await canPersonManageOrders(tx, input.shopId, input.actorPersonId))) return invalid;
      const [locked] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)))
        .for("update");
      if (!locked || !(await canPersonManageOrders(tx, input.shopId, input.actorPersonId)))
        return invalid;
      const [order] = await tx
        .update(orders)
        .set({ status: "void", updatedAt: nowDate() })
        .where(
          and(
            eq(orders.id, input.orderId),
            eq(orders.shopId, input.shopId),
            eq(orders.collection, "local_invoice"),
            eq(orders.status, "open"),
          ),
        )
        .returning();
      if (!order) return invalid;
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
      await tx.insert(activityEvents).values({
        shopId: input.shopId,
        orderId: order.id,
        actorPersonId: input.actorPersonId,
        subjectPersonId: order.personId,
        code: "local_order_voided",
        audience: "staff",
        params: { actor: actor?.name ?? "" },
      });
      return { ok: true as const, order };
    })
    .catch(refusal);
}
