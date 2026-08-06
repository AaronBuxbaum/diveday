import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { InvoicingProvider, RefundInvoiceResult } from "@/lib/payments/invoicing";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { refundOrder } from "./orders";
import { orders, paymentOperationIntents, people, shops } from "./schema";

/**
 * The refund lock, under genuine contention (PAY-L3).
 *
 * `refundOrder` opens `claimOrderRefund` with `SELECT ... FOR UPDATE` on the
 * order row and then decides, inside that lock, whether a refund of this order
 * is already in flight. Every other test of that function runs on PGlite, which
 * is single-connection: the lock is never contended there, and deleting the
 * `.for("update")` leaves the whole PGlite suite green. This file is the one
 * place that is not true — the same gap `src/db/bookings.postgres.test.ts`
 * closes for the oversell guard, stated from the money side in
 * `src/db/money-replay.test.ts`.
 *
 * ## What "both reached Stripe" costs
 *
 * Without the lock, two staff taps (two tabs, a double-submitted form, a retry
 * after a slow response) both read `status = 'paid'`, both mint their own
 * intent — and therefore their own distinct `Idempotency-Key`, deliberately, so
 * that two *genuine* refunds of one shared payment intent never collapse into
 * one (PAY-C1) — and both call Stripe. Only Stripe's own over-refund rejection
 * stops the money moving twice. The tests below assert the cheaper, local
 * refusal happens first: exactly one contender reaches the provider, exactly one
 * refund intent exists, and the losers are told `in_progress` rather than
 * `failed`.
 *
 * ## Why the tests hold a gate open
 *
 * Firing two `refundOrder` calls with `Promise.all` and asserting one won proves
 * nothing: the first can commit its claim before the second's `BEGIN`, and the
 * assertion passes for that sequential run exactly as it does for a contended
 * one. So a third connection takes the order row's lock first, the contenders
 * are started, and the test waits until Postgres itself reports them *all*
 * parked on that lock (`waitForLockWaiters`) before releasing it. With the
 * `FOR UPDATE` gone nothing would ever block, the wait would time out, and the
 * test fails — so the guard's presence is asserted, not assumed.
 */

/** A shop, a customer, and one paid order with a refundable Stripe invoice. */
async function paidOrder(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({
      name: `Refund Race Divers ${suffix}`,
      slug: `refund-race-${suffix}`,
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Nora Quinn", email: `nora-${suffix}@example.com` })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  // Inserted directly rather than through `createOrder`: this file is about one
  // transaction's locking behaviour, and the order's provenance is irrelevant
  // to it. `bookingId` is deliberately null so `applyOrderUpdate`'s booking
  // cascade stays out of the picture and the only contended row is the order.
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      status: "paid",
      currency: "usd",
      totalCents: 22_000,
      amountPaidCents: 22_000,
      stripeAccountId: "acct_race",
      stripeCustomerId: `cus_${suffix}`,
      stripeInvoiceId: `in_${suffix}`,
    })
    .returning();
  if (!order) throw new Error("order insert returned no row");
  return { shopId: shop.id, orderId: order.id };
}

/** The lock `claimOrderRefund` takes first, held open by the starting gate. */
const orderRowLock = (orderId: string) =>
  sql`select id from orders where id = ${orderId} for update`;

/**
 * An invoicing provider that counts reversals and records the idempotency key
 * of each. Anything that reaches it has already passed the local guard, so the
 * count *is* the number of refunds Stripe was asked for.
 */
function countingInvoicing(): { provider: InvoicingProvider; keys: string[] } {
  const keys: string[] = [];
  // `refundInvoice` is the only method this path reaches; the rest throw rather
  // than returning a plausible stub, so a call that shouldn't happen fails the
  // test loudly instead of passing quietly.
  const unreachable = () => {
    throw new Error("countingInvoicing: unexpected provider call");
  };
  const provider: InvoicingProvider = {
    createInvoice: unreachable,
    voidInvoice: unreachable,
    retrieveInvoice: unreachable,
    resendInvoice: unreachable,
    async refundInvoice(
      _accountId: string,
      _invoiceId: string,
      idempotencyKey: string,
    ): Promise<RefundInvoiceResult> {
      keys.push(idempotencyKey);
      return { status: "refunded", refundId: `re_${keys.length}` };
    },
  };
  return { provider, keys };
}

async function refundIntentCount(db: AppDb, orderId: string): Promise<number> {
  const rows = await db
    .select({ id: paymentOperationIntents.id })
    .from(paymentOperationIntents)
    .where(eq(paymentOperationIntents.orderId, orderId));
  return rows.length;
}

describePostgres("refundOrder under real concurrency", () => {
  it("lets exactly one of two simultaneous refunds reach Stripe", async () => {
    const pg = await postgresTestDb();
    const { shopId, orderId } = await paidOrder(pg.db);
    const invoicing = countingInvoicing();

    const gate = await holdRowLock(pg, orderRowLock(orderId));
    // Two genuinely separate connections, so these are two Postgres backends —
    // not two awaits interleaved on one.
    const first = refundOrder(pg.connect(), shopId, orderId, invoicing.provider);
    const second = refundOrder(pg.connect(), shopId, orderId, invoicing.provider);

    // Both are now inside `claimOrderRefund`'s transaction and blocked on the
    // order row. This is the assertion that the `FOR UPDATE` exists at all:
    // without it neither backend would ever wait, and this throws.
    await waitForLockWaiters(pg.db, 2);
    await gate.release();

    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.status === "refunded")).toHaveLength(1);
    // Refused *locally*, and told so — not `failed`, which would send staff
    // back to press the button a third time.
    expect(outcomes.filter((outcome) => outcome.status !== "refunded")).toEqual([
      { status: "in_progress" },
    ]);
    // The refusal is not the point on its own — the money is. A second
    // reversal shows up here as 2 even if the loser was told `in_progress`.
    expect(invoicing.keys).toHaveLength(1);
    expect(await refundIntentCount(pg.db, orderId)).toBe(1);
  });

  it("refuses four of five simultaneous taps and asks Stripe once", async () => {
    // Past a single pair, where a guard that lets one extra through stops being
    // invisible: five contenders would otherwise be five reversals of one
    // charge, each with its own distinct idempotency key, so Stripe's own
    // replay protection cannot collapse them either.
    const pg = await postgresTestDb();
    const { shopId, orderId } = await paidOrder(pg.db);
    const invoicing = countingInvoicing();

    const gate = await holdRowLock(pg, orderRowLock(orderId));
    const contenders = [0, 1, 2, 3, 4].map(() =>
      refundOrder(pg.connect(), shopId, orderId, invoicing.provider),
    );

    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.status === "refunded")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "in_progress")).toHaveLength(4);
    expect(invoicing.keys).toHaveLength(1);
    expect(await refundIntentCount(pg.db, orderId)).toBe(1);

    const [row] = await pg.db.select().from(orders).where(eq(orders.id, orderId));
    expect(row).toMatchObject({ status: "refunded", amountPaidCents: 0 });
  });

  it("refuses a second refund of an order the first already settled", async () => {
    // The sequential half, under a real server rather than PGlite: once the
    // winner's `refunded` status is committed, the plain status read turns the
    // next attempt away with `not_paid` and Stripe is never asked again.
    const pg = await postgresTestDb();
    const { shopId, orderId } = await paidOrder(pg.db);
    const invoicing = countingInvoicing();

    expect((await refundOrder(pg.db, shopId, orderId, invoicing.provider)).status).toBe("refunded");
    expect(await refundOrder(pg.db, shopId, orderId, invoicing.provider)).toEqual({
      status: "not_paid",
    });
    expect(invoicing.keys).toHaveLength(1);
  });
});
