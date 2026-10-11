import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orders, paymentDisputes, people } from "@/db/schema";
import { seededShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import { loadOrderHeader } from "./order-header";

/** A seeded paid order with an undecided dispute on it. */
async function disputedOrder() {
  const { db, shop } = await seededShopContext();
  const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
  if (!person) throw new Error("seeded person missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      status: "paid",
      currency: "usd",
      totalCents: 5_000,
      amountPaidCents: 5_000,
      stripeAccountId: "acct_demo",
      stripeCustomerId: "cus_banner",
      stripeInvoiceId: "in_banner",
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  const now = new Date("2026-10-09T12:00:00Z");
  await db.insert(paymentDisputes).values({
    shopId: shop.id,
    stripeAccountId: "acct_demo",
    stripeDisputeId: "dp_banner",
    stripePaymentIntentId: "pi_banner",
    orderId: order.id,
    amountCents: 5_000,
    currency: "usd",
    status: "needs_response",
    evidenceDueBy: new Date("2026-10-17T12:00:00Z"),
    openedAt: now,
    lastEventAt: now,
  });
  return { db, shop, order };
}

describe("loadOrderHeader's dispute", () => {
  it("shows the dispute to someone who may read the shop's money", async () => {
    const { db, shop, order } = await disputedOrder();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const { dispute } = await loadOrderHeader(db, {
      shopId: shop.id,
      orderId: order.id,
      personId: owner,
    });
    expect(dispute?.amountCents).toBe(5_000);
  });

  it("shows nothing to crew, the same gate Today's dispute row keeps", async () => {
    const { db, shop, order } = await disputedOrder();
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    const { dispute } = await loadOrderHeader(db, {
      shopId: shop.id,
      orderId: order.id,
      personId: captain,
    });
    expect(dispute).toBeNull();
  });
});

describe("loadOrderHeader's rental ticket", () => {
  it("is null for an order no counter rental billed", async () => {
    const { db, shop, order } = await disputedOrder();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const { rentalTicketId } = await loadOrderHeader(db, {
      shopId: shop.id,
      orderId: order.id,
      personId: owner,
    });
    expect(rentalTicketId).toBeNull();
  });
});
