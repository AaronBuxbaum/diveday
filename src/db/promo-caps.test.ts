import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { resolvePaymentOperation, startPaymentOperation } from "./payment-operations";
import { reserveDiscountUse } from "./promo-caps";
import { bookingCheckouts, paymentOperationIntents, shops, trips } from "./schema";
import { createShopPromoCode } from "./shop-promos";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

async function cappedCode(cap: number | null) {
  const { db, shop } = await seededShopContext();
  await upsertShopStripeAccount(db, shop.id, "acct_caps");
  await setShopStripeAccountStatus(db, "acct_caps", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const created = await createShopPromoCode(
    db,
    { shopId: shop.id, code: "CAPS", discountPercent: 10, scope: "all", maxRedemptions: cap },
    fakePromotions(),
  );
  if (!created.ok) throw new Error(`promo creation failed: ${created.reason}`);
  return { db, shop, promo: created.promo };
}

describe("reserveDiscountUse", () => {
  it("tags the attempt's own started intent, and counts it against the next", async () => {
    const { db, shop, promo } = await cappedCode(1);
    const ref = { shopId: shop.id, source: "shop" as const, promoId: promo.id, now: nowDate() };
    const first = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(await reserveDiscountUse(db, { ...ref, intentId: first.id })).toBe("reserved");
    const [tagged] = await db
      .select({ promoCodeId: paymentOperationIntents.promoCodeId })
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.id, first.id));
    expect(tagged?.promoCodeId).toBe(promo.id);

    const second = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(await reserveDiscountUse(db, { ...ref, intentId: second.id })).toBe("used_up");
  });

  it("counts an attempt once while its checkout row has landed and its intent is still open", async () => {
    // Layer-7 confirm review: between the pending checkout's insert and the
    // intent's resolve, the same use read as both, refusing the last real buyer.
    const { db, shop, promo } = await cappedCode(2);
    const ref = { shopId: shop.id, source: "shop" as const, promoId: promo.id, now: nowDate() };
    const first = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(await reserveDiscountUse(db, { ...ref, intentId: first.id })).toBe("reserved");
    await db
      .update(paymentOperationIntents)
      .set({ stripeObjectId: "cs_caps_first" })
      .where(eq(paymentOperationIntents.id, first.id));
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!trip) throw new Error("seeded shop has no trip");
    await db.insert(bookingCheckouts).values({
      shopId: shop.id,
      tripId: trip.id,
      stripeAccountId: "acct_caps",
      stripeSessionId: "cs_caps_first",
      promoCodeId: promo.id,
      currency: "usd",
      amountPerDiverCents: 10000,
      totalCents: 9000,
    });

    const second = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(await reserveDiscountUse(db, { ...ref, intentId: second.id })).toBe("reserved");
  });

  it("holds nothing for an intent that has already resolved", async () => {
    // Layer-7 final review: the tag was written by id alone, so a resolved
    // intent read back as "reserved" while holding no use at all.
    const { db, shop, promo } = await cappedCode(1);
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: "test" });
    expect(
      await reserveDiscountUse(db, {
        shopId: shop.id,
        source: "shop",
        promoId: promo.id,
        intentId: intent.id,
        now: nowDate(),
      }),
    ).toBe("not_reserved");
  });

  it("never tags another shop's intent", async () => {
    const { db, shop, promo } = await cappedCode(1);
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Caps", slug: "other-caps-promo", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const foreign = await startPaymentOperation(db, { shopId: other.id, kind: "checkout_session" });
    expect(
      await reserveDiscountUse(db, {
        shopId: shop.id,
        source: "shop",
        promoId: promo.id,
        intentId: foreign.id,
        now: nowDate(),
      }),
    ).toBe("not_reserved");
  });

  it("reserves nothing for an uncapped code", async () => {
    const { db, shop, promo } = await cappedCode(null);
    const intent = await startPaymentOperation(db, { shopId: shop.id, kind: "checkout_session" });
    expect(
      await reserveDiscountUse(db, {
        shopId: shop.id,
        source: "shop",
        promoId: promo.id,
        intentId: intent.id,
        now: nowDate(),
      }),
    ).toBe("uncapped");
  });
});
