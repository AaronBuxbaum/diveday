import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  activityEvents,
  collectionEntries,
  integrationEvents,
  orderLineItems,
  orders,
} from "../../db/schema";
import { setShopCurrency } from "../../db/shops";
import { getTripRoster, upcomingTripsWithCounts } from "../../db/trips";
import { fileScopedShopContext } from "../../test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "../../test/staff-session";
import { getPurchaseForm, recordPurchase, recordPurchaseRefund } from "./store";

const ctx = fileScopedShopContext();
async function setup() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  if (!trip) throw new Error("missing trip");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("missing person");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
  const input = {
    attemptId: randomUUID(),
    shopId: shop.id,
    personId: entry.person.id,
    createdByPersonId: captain,
    collection: "bank_transfer" as const,
    currency: "usd",
    taxCents: 700,
    tipCents: 500,
    receiptReference: "Counter-123",
    lineItems: [
      {
        kind: "merchandise" as const,
        description: "Reef shirt, tax included",
        quantity: 2,
        unitAmountCents: 5000,
      },
      {
        kind: "pass_through_fee" as const,
        description: "Park fee",
        quantity: 1,
        unitAmountCents: 1000,
      },
    ],
  };
  return { db, shop, input, owner, captain };
}

describe("recorded purchases", () => {
  it("keeps zero-decimal receipts and refunds in their original currency after a shop change", async () => {
    const { db, input, owner } = await setup();
    await setShopCurrency(db, input.shopId, "jpy");
    const yen = {
      ...input,
      currency: "jpy",
      taxCents: 7,
      tipCents: 3,
      lineItems: [
        { kind: "merchandise" as const, description: "Shirt", quantity: 1, unitAmountCents: 110 },
      ],
    };
    const sale = await recordPurchase(db, yen);
    if (!sale.ok) throw new Error("yen receipt failed");
    await setShopCurrency(db, input.shopId, "eur");
    const refund = {
      shopId: input.shopId,
      orderId: sale.order.id,
      actorPersonId: owner,
      attemptId: randomUUID(),
      amountCents: 55,
      currency: "jpy",
      expectedRefundedCents: 0,
      reason: "Returned",
    };
    expect(await recordPurchaseRefund(db, { ...refund, currency: "eur" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    const returned = await recordPurchaseRefund(db, refund);
    expect(returned).toMatchObject({
      ok: true,
      order: { currency: "jpy", amountPaidCents: 55, taxCents: 4, tipCents: 1 },
    });
    const lots = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceId, sale.order.id));
    expect(lots.map((row) => [row.currency, row.amountCents])).toEqual([
      ["jpy", 100],
      ["jpy", -50],
    ]);
  });

  it("records merchandise and split-out tax/tip/levy once, without Stripe setup", async () => {
    const { db, shop, input, captain } = await setup();
    expect(await getPurchaseForm(db, shop.id, captain)).not.toBeNull();
    const first = await recordPurchase(db, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.order).toMatchObject({
      id: input.attemptId,
      status: "paid",
      totalCents: 11000,
      amountPaidCents: 11000,
      taxCents: 700,
      tipCents: 500,
      passThroughCents: 1000,
      stripeInvoiceId: null,
      currency: "usd",
    });
    expect(await recordPurchase(db, input)).toEqual(first);
    const lots = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceId, first.order.id));
    expect(lots.map((r) => r.amountCents)).toEqual([8800]);
    expect(lots[0]?.evidence.originalTipCents).toBe(500);
    expect(
      await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, first.order.id)),
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(integrationEvents)
        .where(eq(integrationEvents.entityId, first.order.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.orderId, first.order.id),
            eq(activityEvents.code, "purchase_recorded"),
          ),
        ),
    ).toHaveLength(1);
    expect(await recordPurchase(db, { ...input, taxCents: 800 })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses unsupported/unsafe lines, non-staff, stale currency and impossible splits", async () => {
    const { db, input } = await setup();
    const firstLine = input.lineItems[0];
    if (!firstLine) throw new Error("line missing");
    for (const patch of [
      { currency: "jpy" },
      { createdByPersonId: input.personId },
      { taxCents: 12000 },
      { tipCents: -1 },
      { lineItems: [{ ...firstLine, kind: "dive_package" as const }] },
      { collectedAt: new Date("2200-01-01") },
      { receiptReference: "x".repeat(101) },
    ])
      expect(await recordPurchase(db, { ...input, ...patch })).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(await db.select().from(orders).where(eq(orders.id, input.attemptId))).toHaveLength(0);
  });

  it("records partial external refunds once, preserves originals, reverses fee lots and rejects stale/over-refund", async () => {
    const { db, input, owner, captain } = await setup();
    const sale = await recordPurchase(db, input);
    if (!sale.ok) throw new Error("sale failed");
    const refund = {
      shopId: input.shopId,
      orderId: sale.order.id,
      actorPersonId: owner,
      attemptId: randomUUID(),
      amountCents: 5500,
      currency: input.currency,
      expectedRefundedCents: 0,
      reason: "Shirt returned",
    };
    expect(await recordPurchaseRefund(db, { ...refund, actorPersonId: captain })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    const first = await recordPurchaseRefund(db, refund);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.order).toMatchObject({
      status: "partly_refunded",
      amountPaidCents: 5500,
      refundedCents: 5500,
      taxCents: 350,
      tipCents: 250,
      passThroughCents: 500,
    });
    expect(await recordPurchaseRefund(db, refund)).toEqual(first);
    expect((await recordPurchase(db, input)).ok).toBe(true);
    expect(await recordPurchaseRefund(db, { ...refund, attemptId: randomUUID() })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(
      await recordPurchaseRefund(db, {
        ...refund,
        attemptId: randomUUID(),
        expectedRefundedCents: 5500,
        amountCents: 5501,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    const final = await recordPurchaseRefund(db, {
      ...refund,
      attemptId: randomUUID(),
      expectedRefundedCents: 5500,
    });
    expect(final.ok && final.order.status).toBe("refunded");
    const lots = await db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceId, sale.order.id));
    expect(lots.map((r) => r.amountCents)).toEqual([8800, -4400, -4400]);
    expect(lots[1]?.reversesEntryId).toBe(lots[0]?.id);
    expect(
      await db
        .select()
        .from(activityEvents)
        .where(
          and(eq(activityEvents.orderId, sale.order.id), eq(activityEvents.code, "order_refunded")),
        ),
    ).toHaveLength(2);
  });

  it("keeps a zero-basis receipt excluded through refunds and retry", async () => {
    const { db, input, owner } = await setup();
    const zero = { ...input, taxCents: 6000, tipCents: 4000 };
    const sale = await recordPurchase(db, zero);
    if (!sale.ok) throw new Error("sale failed");
    expect(
      await recordPurchaseRefund(db, {
        shopId: input.shopId,
        orderId: sale.order.id,
        actorPersonId: owner,
        attemptId: randomUUID(),
        amountCents: 5500,
        currency: input.currency,
        expectedRefundedCents: 0,
        reason: "Return",
      }),
    ).toMatchObject({ ok: true });
    expect((await recordPurchase(db, zero)).ok).toBe(true);
    expect(
      await db
        .select()
        .from(collectionEntries)
        .where(eq(collectionEntries.sourceId, sale.order.id)),
    ).toHaveLength(0);
  });
});
