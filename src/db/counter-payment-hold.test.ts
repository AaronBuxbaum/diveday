import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { SEND_HOLD_MS } from "@/lib/held-sends";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import type { AppDb } from "./client";
import { holdCounterPayment, pendingCounterPayment } from "./counter-payment-hold";
import { claimHeldSend, drainHeldSends, executeHeldSend, undoHeldSend } from "./held-sends";
import { activityEvents, heldSends, orders, people, shops } from "./schema";

/**
 * **Record payment: one tap with an eight-second Undo hold** (issue #3030,
 * decided 2026-10-25; H-68's hold). Cash or the card machine is held, not
 * recorded: Undo inside the hold leaves the order exactly as it was, the
 * hold running out records it, a staffer who walks away inside the hold has
 * it recorded by the sweep (as a held send is sent), and a second tap inside
 * the hold is the same hold, so the order is paid once.
 *
 * On a demo shop, so the record path never reaches Stripe; which path runs
 * is the shop row's call (`counter-actions.test.ts`).
 */

vi.mock("./stripe-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-providers")>();
  return {
    ...actual,
    invoicingProviderFromEnvironment: vi.fn(() => {
      throw new Error("the demo path reached for Stripe");
    }),
  };
});

// A fresh database per test: money, and its subject takes row locks
// (src/test/db.ts, "When NOT to use this").
async function fixture() {
  const { db, shop } = await seededShopContext();
  await db.update(shops).set({ isDemo: true }).where(eq(shops.id, shop.id));
  const staff = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const [guest] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Felix Hold", email: "felix-hold@example.com" })
    .returning();
  const [order] = await db
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
    })
    .returning();
  return { db, shopId: shop.id, staff, order };
}

async function reread(db: AppDb, id: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

async function paidLines(db: AppDb, orderId: string) {
  return db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(and(eq(activityEvents.orderId, orderId)));
}

const now = new Date("2026-10-25T15:00:00Z");

describe("a counter payment held with Undo", () => {
  it("records nothing during the hold, and records the balance when the hold runs out", async () => {
    const { db, shopId, staff, order } = await fixture();
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "cash",
      now,
    });
    if (!held) throw new Error("expected a hold");
    expect(held.runAt.getTime() - now.getTime()).toBe(SEND_HOLD_MS);
    // Inside the hold the order is untouched.
    expect(await reread(db, order.id)).toMatchObject({ status: "open", amountPaidCents: 0 });
    expect(await paidLines(db, order.id)).toHaveLength(0);

    // The tapping screen counted the eight seconds down and asks for it.
    const claim = await claimHeldSend(db, shopId, held.id, undefined, { early: true });
    if (claim.status !== "claimed") throw new Error("expected a claim");
    const outcome = await executeHeldSend(db, claim.row);
    expect(outcome).toMatchObject({ kind: "counter_payment", demo: true, outcome: { ok: true } });
    expect(await reread(db, order.id)).toMatchObject({
      status: "paid",
      collection: "cash",
      amountPaidCents: 34_000,
    });
    // The log names who recorded it, once.
    expect(await paidLines(db, order.id)).toHaveLength(1);
  });

  it("records it when the staffer navigates away inside the hold: the sweep commits it", async () => {
    const { db, shopId, staff, order } = await fixture();
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "card_machine",
      now,
    });
    if (!held) throw new Error("expected a hold");
    // No release from the page: the tab went elsewhere. The sweep finds the
    // drained hold and records it, as it sends a held message.
    expect(await drainHeldSends(db, new Date(now.getTime() - 1_000))).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(await drainHeldSends(db, held.runAt)).toEqual({ sent: 1, failed: 0 });
    expect(await reread(db, order.id)).toMatchObject({
      status: "paid",
      collection: "card_machine",
      amountPaidCents: 34_000,
    });
    expect(await paidLines(db, order.id)).toHaveLength(1);
    expect(await db.select().from(heldSends).where(eq(heldSends.id, held.id))).toHaveLength(0);
  });

  it("leaves the order untouched and records nothing on Undo", async () => {
    const { db, shopId, staff, order } = await fixture();
    const before = await reread(db, order.id);
    const held = await holdCounterPayment(db, {
      shopId,
      orderId: order.id,
      actorPersonId: staff,
      collection: "cash",
      now,
    });
    if (!held) throw new Error("expected a hold");
    expect(await undoHeldSend(db, shopId, held.id, new Date(now.getTime() + 3_000))).toBe(true);
    // Nothing is left for the sweep, and the order is exactly as it was.
    expect(await drainHeldSends(db, new Date(now.getTime() + 60_000))).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(await reread(db, order.id)).toEqual(before);
    expect(await paidLines(db, order.id)).toHaveLength(0);
    expect(await pendingCounterPayment(db, shopId, order.id)).toBeNull();
  });

  it("treats a second tap inside the hold as the same hold, so the order is paid once", async () => {
    const { db, shopId, staff, order } = await fixture();
    const input = { shopId, orderId: order.id, actorPersonId: staff, now };
    const first = await holdCounterPayment(db, { ...input, collection: "cash" });
    // The other machine, a second later: still the one hold, still cash.
    const second = await holdCounterPayment(db, {
      ...input,
      collection: "card_machine",
      now: new Date(now.getTime() + 1_000),
    });
    if (!first || !second) throw new Error("expected holds");
    expect(second).toEqual(first);
    expect(
      await db.select().from(heldSends).where(eq(heldSends.kind, "counter_payment")),
    ).toHaveLength(1);
    expect(await pendingCounterPayment(db, shopId, order.id)).toMatchObject({
      id: first.id,
      payload: { kind: "counter_payment", orderId: order.id, collection: "cash" },
    });

    // Both screens ask for the release: exactly one claims it.
    const claims = await Promise.all([
      claimHeldSend(db, shopId, first.id, undefined, { early: true }),
      claimHeldSend(db, shopId, second.id, undefined, { early: true }),
    ]);
    const claimed = claims.filter((claim) => claim.status === "claimed");
    expect(claimed).toHaveLength(1);
    const [one] = claimed;
    if (one?.status !== "claimed") throw new Error("expected one claim");
    await executeHeldSend(db, one.row);
    expect(await drainHeldSends(db, new Date(now.getTime() + 60_000))).toEqual({
      sent: 0,
      failed: 0,
    });
    expect(await reread(db, order.id)).toMatchObject({
      status: "paid",
      collection: "cash",
      amountPaidCents: 34_000,
    });
    expect(await paidLines(db, order.id)).toHaveLength(1);
    // A tap after the hold landed finds no open order to hold.
    expect(await holdCounterPayment(db, { ...input, collection: "cash" })).toBeNull();
  });

  it("holds nothing for an order that is not open, or not this shop's", async () => {
    const { db, shopId, staff, order } = await fixture();
    await db.update(orders).set({ status: "void" }).where(eq(orders.id, order.id));
    expect(
      await holdCounterPayment(db, {
        shopId,
        orderId: order.id,
        actorPersonId: staff,
        collection: "cash",
        now,
      }),
    ).toBeNull();
    expect(
      await holdCounterPayment(db, {
        shopId: crypto.randomUUID(),
        orderId: order.id,
        actorPersonId: staff,
        collection: "cash",
        now,
      }),
    ).toBeNull();
    expect(await db.select().from(heldSends)).toHaveLength(0);
  });
});
