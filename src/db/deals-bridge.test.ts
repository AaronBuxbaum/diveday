import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import {
  bookingCheckouts,
  deals,
  paymentOperationIntents,
  retiredShopPromoCodes,
  retiredTripLastMinutePromos,
  shops,
  trips,
} from "./schema";

/**
 * **The deploy-window bridge** (issue #2720, ADR 20261103-a-deal-is-one-row).
 * The release still serving while the deals migration runs writes the two
 * retired promo tables and the two retired checkout columns; the migration's
 * triggers forward those writes, so whatever it mints, switches off or spends
 * is the same deal after the deploy.
 */

async function fixture(db: AppDb, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  const start = new Date("2026-06-10T13:00:00Z");
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Wreck",
      startsAt: start,
      endsAt: new Date(start.getTime() + 3 * 3_600_000),
      capacity: 10,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  return { shopId: shop.id, tripId: trip.id, startsAt: start };
}

async function dealById(db: AppDb, id: string) {
  const [row] = await db.select().from(deals).where(eq(deals.id, id));
  return row ?? null;
}

describe("the retired promo tables forward to deals", () => {
  it("forwards a shop-wide code's mint, switch-off and delete under the same id", async () => {
    const db = await unseededTestDb();
    const { shopId } = await fixture(db, "bridge-shop-code");
    const [code] = await db
      .insert(retiredShopPromoCodes)
      .values({ shopId, code: "REEF10", discountPercent: 10, scope: "trips", maxRedemptions: 5 })
      .returning();
    if (!code) throw new Error("code insert failed");
    expect(await dealById(db, code.id)).toMatchObject({
      tripId: null,
      code: "REEF10",
      discountPercent: 10,
      scope: "trips",
      status: "pending",
      maxRedemptions: 5,
    });

    await db
      .update(retiredShopPromoCodes)
      .set({ status: "active", stripeCouponId: "co_1", stripePromotionCodeId: "promo_1" })
      .where(eq(retiredShopPromoCodes.id, code.id));
    expect(await dealById(db, code.id)).toMatchObject({
      status: "active",
      stripePromotionCodeId: "promo_1",
    });
    await db
      .update(retiredShopPromoCodes)
      .set({ status: "disabled" })
      .where(eq(retiredShopPromoCodes.id, code.id));
    expect((await dealById(db, code.id))?.status).toBe("disabled");

    const [failed] = await db
      .insert(retiredShopPromoCodes)
      .values({ shopId, code: "BROKEN", discountAmountCents: 2_000, status: "failed" })
      .returning();
    if (!failed) throw new Error("code insert failed");
    await db.delete(retiredShopPromoCodes).where(eq(retiredShopPromoCodes.id, failed.id));
    expect(await dealById(db, failed.id)).toBeNull();
  });

  it("forwards a last-minute deal, reading its sent as active", async () => {
    const db = await unseededTestDb();
    const { shopId, tripId, startsAt } = await fixture(db, "bridge-trip-deal");
    const [deal] = await db
      .insert(retiredTripLastMinutePromos)
      .values({ shopId, tripId, code: "SAVE25-A1B2C3", discountPercent: 25, expiresAt: startsAt })
      .returning();
    if (!deal) throw new Error("deal insert failed");
    await db
      .update(retiredTripLastMinutePromos)
      .set({ status: "sent", stripePromotionCodeId: "promo_2", recipientCount: 4 })
      .where(eq(retiredTripLastMinutePromos.id, deal.id));
    expect(await dealById(db, deal.id)).toMatchObject({
      tripId,
      status: "active",
      expiresAt: startsAt,
      recipientCount: 4,
      stripePromotionCodeId: "promo_2",
    });
  });

  it("fills deal_id on a checkout and an intent that name a retired column", async () => {
    const db = await unseededTestDb();
    const { shopId, tripId, startsAt } = await fixture(db, "bridge-checkout");
    const [deal] = await db
      .insert(retiredTripLastMinutePromos)
      .values({ shopId, tripId, code: "SAVE30-D4E5F6", discountPercent: 30, expiresAt: startsAt })
      .returning();
    if (!deal) throw new Error("deal insert failed");
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId,
        tripId,
        stripeAccountId: "acct_bridge",
        stripeSessionId: "cs_bridge",
        currency: "usd",
        amountPerDiverCents: 10_000,
        totalCents: 10_000,
        retiredTripPromoId: deal.id,
      })
      .returning();
    expect(checkout?.dealId).toBe(deal.id);

    const [intent] = await db
      .insert(paymentOperationIntents)
      .values({ shopId, kind: "checkout_session", tripId })
      .returning();
    if (!intent) throw new Error("intent insert failed");
    const [tagged] = await db
      .update(paymentOperationIntents)
      .set({ retiredTripPromoId: deal.id })
      .where(eq(paymentOperationIntents.id, intent.id))
      .returning();
    expect(tagged?.dealId).toBe(deal.id);
  });
});
