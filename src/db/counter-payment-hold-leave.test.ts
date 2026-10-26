import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import type { AppDb } from "./client";
import { commitCounterPaymentHold, holdCounterPayment } from "./counter-payment-hold";
import { drainHeldSends } from "./held-sends";
import { STALE_AFTER_MS } from "./payment-operations";
import { getMonthlyReport } from "./reporting";
import { activityEvents, heldSends, orders, people, shops } from "./schema";

/**
 * **The counter payment hold, review of #3061** (dde-a F2, security 2):
 *
 * - A screen that leaves inside the hold commits it then, not at the hourly
 *   sweep, so the order stops reading Open within seconds.
 * - Every path records the tap's own time as `paid_at`: a 23:55 tap is that
 *   day's money even when the sweep records it after midnight.
 * - A hold that records nothing (the diver paid online inside it) says so in
 *   the shop's log, under the tapper's name.
 * - An order left with a stale counter claim can be held and recorded again.
 *
 * A real shop here, with Stripe's out-of-band mark answered "paid", so the
 * path is the one a shop with an account takes; the demo path is
 * `counter-payment-hold.test.ts`'s.
 */

const marked = vi.fn(async () => ({ status: "paid" as const }));
vi.mock("./stripe-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-providers")>();
  return {
    ...actual,
    invoicingProviderFromEnvironment: vi.fn(() => ({ markInvoicePaidOutOfBand: marked })),
  };
});

beforeEach(() => marked.mockClear());

// A fresh database per test: money, and its subject takes row locks.
async function fixture(options: { demo?: boolean } = {}) {
  const { db, shop } = await seededShopContext();
  await db
    .update(shops)
    .set({ isDemo: options.demo === true })
    .where(eq(shops.id, shop.id));
  const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const [guest] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Felix Leave", email: "felix-leave@example.com" })
    .returning();
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: guest.id,
      createdByPersonId: staff,
      currency: "usd",
      totalCents: 34_000,
      stripeAccountId: "acct_leave",
      stripeCustomerId: "cus_leave",
      stripeInvoiceId: `in_leave_${crypto.randomUUID()}`,
    })
    .returning();
  return { db, shopId: shop.id, staff, order };
}

async function reread(db: AppDb, id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

async function linesOf(db: AppDb, orderId: string) {
  return db
    .select({ code: activityEvents.code, actor: activityEvents.actorPersonId })
    .from(activityEvents)
    .where(and(eq(activityEvents.orderId, orderId)));
}

// 23:55 on Oct 31 in Key Largo (EDT), and the sweep at 00:01 on Nov 1.
const TAP = new Date("2026-11-01T03:55:00Z");
const SWEEP = new Date("2026-11-01T04:01:00Z");
const OCT = [new Date("2026-10-01T04:00:00Z"), new Date("2026-11-01T04:00:00Z")] as const;
const NOV = [new Date("2026-11-01T04:00:00Z"), new Date("2026-12-01T05:00:00Z")] as const;

async function counterCents(db: AppDb, shopId: string, [start, end]: readonly [Date, Date]) {
  const report = await getMonthlyReport(db, shopId, start, end, {
    timeZone: "America/New_York",
  });
  return report.counterCents ?? 0;
}

describe("a counter payment hold the screen left", () => {
  it("is recorded as the screen goes, stamped with the tap's time", async () => {
    const { db, shopId, staff, order } = await fixture();
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "cash",
      now: TAP,
    });
    if (!held) throw new Error("expected a hold");
    const left = await commitCounterPaymentHold(db, {
      shopId,
      heldId: held.id,
      now: new Date(TAP.getTime() + 3_000),
    });
    expect(left).toMatchObject({ status: "done", orderId: order.id });
    expect(await reread(db, order.id)).toMatchObject({
      status: "paid",
      collection: "cash",
      amountPaidCents: 34_000,
      paidAt: TAP,
    });
    expect(marked).toHaveBeenCalledOnce();
    expect(await linesOf(db, order.id)).toEqual([{ code: "order_paid_cash", actor: staff }]);
    // Committed once: the sweep finds nothing left.
    expect(await db.select().from(heldSends).where(eq(heldSends.id, held.id))).toHaveLength(0);
    expect(await drainHeldSends(db, SWEEP)).toEqual({ sent: 0, failed: 0 });
  });

  it("lands a 23:55 tap the sweep records after midnight on that day's report", async () => {
    const { db, shopId, staff, order } = await fixture();
    const before = {
      oct: await counterCents(db, shopId, OCT),
      nov: await counterCents(db, shopId, NOV),
    };
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "card_machine",
      now: TAP,
    });
    if (!held) throw new Error("expected a hold");
    // No screen said anything (a dead battery): the sweep is the fallback.
    expect(await drainHeldSends(db, SWEEP)).toEqual({ sent: 1, failed: 0 });
    expect(await reread(db, order.id)).toMatchObject({ status: "paid", paidAt: TAP });
    expect(await counterCents(db, shopId, OCT)).toBe(before.oct + 34_000);
    expect(await counterCents(db, shopId, NOV)).toBe(before.nov);
  });

  it("commits only a counter payment of this shop, and only once", async () => {
    const { db, shopId, staff, order } = await fixture();
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "cash",
      now: TAP,
    });
    if (!held) throw new Error("expected a hold");
    // Another shop's staff holding a copied id commits nothing.
    expect(
      await commitCounterPaymentHold(db, { shopId: crypto.randomUUID(), heldId: held.id }),
    ).toEqual({ status: "gone" });
    expect(await reread(db, order.id)).toMatchObject({ status: "open" });
    expect(await commitCounterPaymentHold(db, { shopId, heldId: held.id })).toMatchObject({
      status: "done",
    });
    expect(await commitCounterPaymentHold(db, { shopId, heldId: held.id })).toEqual({
      status: "gone",
    });
    expect(marked).toHaveBeenCalledOnce();
  });
});

describe("a counter payment hold that records nothing", () => {
  it("tells the shop's log, under the tapper's name, when the diver paid online inside the hold", async () => {
    const { db, shopId, staff, order } = await fixture({ demo: true });
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "cash",
      now: TAP,
    });
    if (!held) throw new Error("expected a hold");
    // Felix paid the hosted invoice from his phone meanwhile.
    await db
      .update(orders)
      .set({ status: "paid", amountPaidCents: 34_000, paidAt: TAP })
      .where(eq(orders.id, order.id));
    expect(await drainHeldSends(db, SWEEP)).toEqual({ sent: 1, failed: 0 });
    expect(await reread(db, order.id)).toMatchObject({ collection: "stripe_invoice" });
    expect(await linesOf(db, order.id)).toEqual([
      { code: "counter_payment_not_recorded_paid_online", actor: staff },
    ]);
  });

  it("says the order was no longer open when it was voided inside the hold", async () => {
    const { db, shopId, staff, order } = await fixture({ demo: true });
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "card_machine",
      now: TAP,
    });
    if (!held) throw new Error("expected a hold");
    await db.update(orders).set({ status: "void" }).where(eq(orders.id, order.id));
    await commitCounterPaymentHold(db, { shopId, heldId: held.id });
    expect(await linesOf(db, order.id)).toEqual([
      { code: "counter_payment_not_recorded", actor: staff },
    ]);
  });
});

describe("an order left with a stale counter claim", () => {
  it("can be held and recorded again, as the one-tap button could", async () => {
    const { db, shopId, staff, order } = await fixture();
    const now = nowDate();
    // A tap whose call died between its claim and Stripe's answer.
    await db
      .update(orders)
      .set({
        collection: "cash",
        counterClaimedAt: new Date(now.getTime() - STALE_AFTER_MS - 60_000),
      })
      .where(eq(orders.id, order.id));
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "card_machine",
      now,
    });
    if (!held) throw new Error("expected a stale claim to be held again");
    await commitCounterPaymentHold(db, { shopId, heldId: held.id, now });
    expect(await reread(db, order.id)).toMatchObject({
      status: "paid",
      collection: "card_machine",
      counterClaimedAt: null,
      paidAt: now,
    });
  });

  it("is not held while the claim is live: another tap is still with Stripe", async () => {
    const { db, shopId, staff, order } = await fixture();
    const now = nowDate();
    await db
      .update(orders)
      .set({ collection: "cash", counterClaimedAt: new Date(now.getTime() - 1_000) })
      .where(eq(orders.id, order.id));
    expect(
      await holdCounterPayment(db, {
        shopId,
        orderId: order.id,
        actorPersonId: staff,
        collection: "cash",
        now,
      }),
    ).toBeNull();
  });
});
