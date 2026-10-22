import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import type { AppDb } from "./client";
import { recordDemoPaymentOnOpenOrder } from "./orders";
import { orders, people, shops } from "./schema";

/**
 * **Record payment on a demo order** (market sheet 2026-10-22, item 6). A demo
 * invoice is made up, so the Stripe path stays shut; cash or the card machine
 * never touches Stripe, so the demo records it locally. The guard is the
 * shop row, read in the same transaction as the write, never the caller's
 * word: a real shop's order, another shop's order, a Stripe-backed method or
 * a non-staff caller is refused and nothing changes.
 */

// Any reach for Stripe from this path fails the test outright.
vi.mock("./stripe-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-providers")>();
  return {
    ...actual,
    invoicingProviderFromEnvironment: vi.fn(() => {
      throw new Error("the demo path reached for Stripe");
    }),
  };
});

// A fresh database per test, not the file-scoped rollback: this file is money
// and its subject takes row locks (src/test/db.ts, "When NOT to use this").
async function fixture({ demo }: { demo: boolean }) {
  const { db, shop } = await seededShopContext();
  await db.update(shops).set({ isDemo: demo }).where(eq(shops.id, shop.id));
  const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const [guest] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Counter Guest", email: "counter-guest@example.com" })
    .returning();
  const open = async (values: Partial<typeof orders.$inferInsert> = {}) => {
    const [row] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: guest.id,
        createdByPersonId: staff,
        currency: "usd",
        totalCents: 34_000,
        stripeAccountId: "acct_demo",
        stripeCustomerId: "cus_demo",
        stripeInvoiceId: `in_demo_${crypto.randomUUID()}`,
        ...values,
      })
      .returning();
    return row;
  };
  return { db, shop, staff, guest, open };
}

async function reread(db: AppDb, id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

describe("recordDemoPaymentOnOpenOrder", () => {
  it.each(["cash", "card_machine"] as const)(
    "settles an open demo invoice by %s, without Stripe",
    async (collection) => {
      const { db, shop, staff, open } = await fixture({ demo: true });
      const order = await open();
      const outcome = await recordDemoPaymentOnOpenOrder(db, {
        shopId: shop.id,
        orderId: order.id,
        actorPersonId: staff,
        collection,
      });
      expect(outcome.ok).toBe(true);
      expect(await reread(db, order.id)).toMatchObject({
        status: "paid",
        collection,
        amountPaidCents: 34_000,
        counterClaimedAt: null,
      });
    },
  );

  it("refuses a real shop's order and leaves it open", async () => {
    const { db, shop, staff, open } = await fixture({ demo: false });
    const order = await open();
    const outcome = await recordDemoPaymentOnOpenOrder(db, {
      shopId: shop.id,
      orderId: order.id,
      actorPersonId: staff,
      collection: "cash",
    });
    expect(outcome).toEqual({ ok: false, reason: "not_demo" });
    expect(await reread(db, order.id)).toMatchObject({
      status: "open",
      collection: "stripe_invoice",
      amountPaidCents: 0,
    });
  });

  it("refuses a real shop's order named through a demo shop's id", async () => {
    // The demo session's shop is demo; the order belongs to a real shop.
    const { db, shop, staff, guest } = await fixture({ demo: true });
    const [real] = await db
      .insert(shops)
      .values({
        name: "Real Reef",
        slug: `real-reef-${crypto.randomUUID().slice(0, 8)}`,
        timezone: "UTC",
      })
      .returning();
    const [theirs] = await db
      .insert(orders)
      .values({
        shopId: real.id,
        personId: guest.id,
        createdByPersonId: staff,
        currency: "usd",
        totalCents: 9_000,
        stripeAccountId: "acct_real",
        stripeCustomerId: "cus_real",
        stripeInvoiceId: "in_real_1",
      })
      .returning();
    const outcome = await recordDemoPaymentOnOpenOrder(db, {
      shopId: shop.id,
      orderId: theirs.id,
      actorPersonId: staff,
      collection: "cash",
    });
    expect(outcome.ok).toBe(false);
    expect(await reread(db, theirs.id)).toMatchObject({ status: "open", amountPaidCents: 0 });
    // And named through the real shop's own id, it is still not a demo.
    const direct = await recordDemoPaymentOnOpenOrder(db, {
      shopId: real.id,
      orderId: theirs.id,
      actorPersonId: staff,
      collection: "cash",
    });
    expect(direct.ok).toBe(false);
    expect(await reread(db, theirs.id)).toMatchObject({ status: "open", amountPaidCents: 0 });
  });

  it.each(["room_charge", "stripe_invoice", "gift", ""])(
    "refuses %j, which is not counter money",
    async (collection) => {
      const { db, shop, staff, open } = await fixture({ demo: true });
      const order = await open();
      const outcome = await recordDemoPaymentOnOpenOrder(db, {
        shopId: shop.id,
        orderId: order.id,
        actorPersonId: staff,
        collection: collection as "cash",
      });
      expect(outcome).toEqual({ ok: false, reason: "invalid" });
      expect((await reread(db, order.id))?.status).toBe("open");
    },
  );

  it("refuses a caller who is not staff here", async () => {
    const { db, shop, guest, open } = await fixture({ demo: true });
    const order = await open();
    const outcome = await recordDemoPaymentOnOpenOrder(db, {
      shopId: shop.id,
      orderId: order.id,
      actorPersonId: guest.id,
      collection: "cash",
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid" });
    expect((await reread(db, order.id))?.status).toBe("open");
  });

  it("refuses an order that is not an open invoice, and never pays one twice", async () => {
    const { db, shop, staff, open } = await fixture({ demo: true });
    const record = (orderId: string) =>
      recordDemoPaymentOnOpenOrder(db, {
        shopId: shop.id,
        orderId,
        actorPersonId: staff,
        collection: "cash",
      });
    const order = await open();
    expect((await record(order.id)).ok).toBe(true);
    expect(await record(order.id)).toEqual({ ok: false, reason: "invalid" });
    expect((await reread(db, order.id))?.amountPaidCents).toBe(34_000);

    const voided = await open({ status: "void" });
    expect((await record(voided.id)).ok).toBe(false);
    const paidOnline = await open({ stripePaymentIntentId: "pi_demo_1" });
    expect((await record(paidOnline.id)).ok).toBe(false);
    expect(await record("00000000-0000-4000-8000-000000000999")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
