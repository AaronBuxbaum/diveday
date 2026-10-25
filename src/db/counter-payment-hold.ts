import { and, eq, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type CounterPaymentPayload, heldSendPayloadSchema, heldSendRunAt } from "@/lib/held-sends";
import type { AppDb, DbExecutor } from "./client";
import {
  type RecordPaymentOnOrderOutcome,
  recordDemoPaymentOnOpenOrder,
  recordPaymentOnOpenOrder,
} from "./orders";
import { heldSends, orders, shops } from "./schema";
import { counterPaymentActivity, recordShopActivity } from "./shop-activity";

/**
 * **Record payment: one tap with an eight-second Undo hold** (issue #3030,
 * decided 2026-10-25; the send hold of H-68 and ADR 20260906-before-you-ask).
 *
 * Cash or the card machine is not recorded on the tap. The tap writes a
 * `held_sends` row of kind `counter_payment` eight seconds out; Undo deletes
 * it and the order is what it was; the tapping screen's release, or the
 * hourly sweep for a screen that went elsewhere, claims the row and records
 * the payment through the same writers the one-tap button used. A second tap
 * on the same order inside the hold is that hold, never a second one, and the
 * record path refuses an order that is no longer open behind that.
 */

export type CounterPaymentOutcome = {
  outcome: RecordPaymentOnOrderOutcome;
  /** A demo shop records locally; its notice says so. */
  demo: boolean;
};

/**
 * Hold a counter payment on an open order, or hand back the hold already
 * draining on it. Null when there is nothing to hold: no such order in this
 * shop, or one that is not an open invoice (paid, void, or claimed by another
 * counter payment already in flight). Under the order's row lock, so two taps
 * at once still make one hold.
 */
export async function holdCounterPayment(
  db: AppDb,
  input: {
    shopId: string;
    orderId: string;
    actorPersonId: string;
    collection: CounterPaymentPayload["collection"];
    now?: Date;
  },
): Promise<{ id: string; runAt: Date } | null> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        status: orders.status,
        collection: orders.collection,
        stripePaymentIntentId: orders.stripePaymentIntentId,
        counterClaimedAt: orders.counterClaimedAt,
      })
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.shopId, input.shopId)))
      .for("update");
    if (
      order?.status !== "open" ||
      order.collection !== "stripe_invoice" ||
      order.stripePaymentIntentId !== null ||
      order.counterClaimedAt !== null
    ) {
      return null;
    }
    const existing = await pendingCounterPaymentRow(tx, input.shopId, input.orderId);
    if (existing) return { id: existing.id, runAt: existing.runAt };
    const payload = heldSendPayloadSchema.parse({
      kind: "counter_payment",
      orderId: input.orderId,
      collection: input.collection,
    });
    const runAt = heldSendRunAt(payload, now);
    const [row] = await tx
      .insert(heldSends)
      .values({
        shopId: input.shopId,
        kind: "counter_payment",
        payload,
        actorPersonId: input.actorPersonId,
        runAt,
      })
      .returning({ id: heldSends.id });
    if (!row) throw new Error("counter payment hold was not written");
    return { id: row.id, runAt };
  });
}

async function pendingCounterPaymentRow(db: DbExecutor, shopId: string, orderId: string) {
  const [row] = await db
    .select({ id: heldSends.id, runAt: heldSends.runAt, payload: heldSends.payload })
    .from(heldSends)
    .where(
      and(
        eq(heldSends.shopId, shopId),
        eq(heldSends.kind, "counter_payment"),
        sql`${heldSends.payload}->>'orderId' = ${orderId}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The counter payment still held on this order, for the order page to show
 * its hold draining with Undo after a reload. Null when there is none.
 */
export async function pendingCounterPayment(
  db: DbExecutor,
  shopId: string,
  orderId: string,
): Promise<{ id: string; runAt: Date; payload: CounterPaymentPayload } | null> {
  const row = await pendingCounterPaymentRow(db, shopId, orderId);
  const parsed = row ? heldSendPayloadSchema.safeParse(row.payload) : null;
  if (!row || !parsed?.success || parsed.data.kind !== "counter_payment") return null;
  return { id: row.id, runAt: row.runAt, payload: parsed.data };
}

/**
 * Record the held payment: locally on a demo shop, through Stripe's
 * out-of-band mark on a real one (`recordPaymentOnOpenOrder`), and on success
 * the activity line naming who tapped it. Both writers re-check staff, the
 * shop and that the order is still open, so a hold that outlived its order's
 * openness records nothing.
 */
export async function recordHeldCounterPayment(
  db: AppDb,
  input: {
    shopId: string;
    actorPersonId: string | null;
    payload: CounterPaymentPayload;
  },
): Promise<CounterPaymentOutcome> {
  const [shop] = await db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, input.shopId));
  const demo = shop?.isDemo === true;
  if (!input.actorPersonId) return { outcome: { ok: false, reason: "invalid" }, demo };
  const { orderId, collection } = input.payload;
  let outcome: RecordPaymentOnOrderOutcome;
  if (demo) {
    const recorded = await recordDemoPaymentOnOpenOrder(db, {
      shopId: input.shopId,
      orderId,
      actorPersonId: input.actorPersonId,
      collection,
    });
    outcome = recorded.ok ? recorded : { ok: false, reason: "invalid" };
  } else {
    outcome = await recordPaymentOnOpenOrder(db, {
      shopId: input.shopId,
      orderId,
      actorPersonId: input.actorPersonId,
      collection,
    });
  }
  if (outcome.ok) {
    await recordShopActivity(db, {
      shopId: input.shopId,
      actorPersonId: input.actorPersonId,
      write: counterPaymentActivity(outcome.order.id, collection),
    });
  }
  return { outcome, demo };
}
