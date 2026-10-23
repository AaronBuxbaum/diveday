import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { shops, tripLastMinutePromos } from "./schema";
import { createShopPromoCode, getRedeemableShopPromo, tripMayTakeACode } from "./shop-promos";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
const NOW = new Date("2026-07-29T12:00:00.000Z");

/** A connected, charges-enabled shop: the precondition for holding any code at all. */
async function promoContext() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop };
}

function promoInput(shopId: string) {
  return { shopId, code: "reef20", discountPercent: 20, scope: "all" as const };
}

/**
 * **Each half follows its switch** (the Features page): promo codes off
 * hides the box for a shop-wide code and refuses one typed anyway, while a
 * trip's deal still brings it as long as the last-minute list is on.
 */
describe("the promo codes and last-minute list switches", () => {
  it("each opens its half of the code box, and only promo codes redeem a shop code", async () => {
    const { db, shop } = await promoContext();
    await createShopPromoCode(db, promoInput(shop.id), fakePromotions());
    const [dealTrip, otherTrip] = await upcomingTripsWithCounts(db, shop.id);
    if (!dealTrip || !otherTrip) throw new Error("demo trips missing");
    await db.insert(tripLastMinutePromos).values({
      shopId: shop.id,
      tripId: dealTrip.id,
      status: "sent",
      discountPercent: 20,
      code: "LASTCALL20",
      expiresAt: new Date(dealTrip.startsAt),
    });
    const redeem = () =>
      getRedeemableShopPromo(db, { shopId: shop.id, code: "REEF20", kind: "trip", now: NOW });
    expect(await redeem()).not.toBeNull();

    await db.update(shops).set({ promoCodesEnabled: false }).where(eq(shops.id, shop.id));
    expect(await redeem()).toBeNull();
    expect(await tripMayTakeACode(db, { shopId: shop.id, tripId: otherTrip.id })).toBe(false);
    expect(await tripMayTakeACode(db, { shopId: shop.id, tripId: dealTrip.id })).toBe(true);

    await db.update(shops).set({ lastMinuteListEnabled: false }).where(eq(shops.id, shop.id));
    expect(await tripMayTakeACode(db, { shopId: shop.id, tripId: dealTrip.id })).toBe(false);

    await db
      .update(shops)
      .set({ promoCodesEnabled: true, lastMinuteListEnabled: true })
      .where(eq(shops.id, shop.id));
    expect(await redeem()).not.toBeNull();
  });
});
