import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { resolvePaymentOperation, startPaymentOperation } from "./payment-operations";
import { discountCapReached, reserveDiscountUse } from "./promo-caps";
import {
  bookingCheckouts,
  paymentOperationIntents,
  shops,
  tripLastMinutePromos,
  trips,
} from "./schema";
import { createShopPromoCode } from "./shop-promos";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

const ctx = fileScopedShopContext();

async function cappedCode(cap: number | null) {
  const { db, shop } = ctx;
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

/** A last-minute deal on one of the seeded shop's departures, cut to `capacity` seats. */
async function tripDeal(opts: {
  maxRedemptions: number | null;
  createdAt: Date;
  capacity: number;
}) {
  const { db, shop } = ctx;
  const [trip] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!trip) throw new Error("seeded shop has no trip");
  await db.update(trips).set({ capacity: opts.capacity }).where(eq(trips.id, trip.id));
  const [deal] = await db
    .insert(tripLastMinutePromos)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      status: "sent",
      discountPercent: 20,
      code: `LAST${opts.capacity}${opts.maxRedemptions ?? "X"}`,
      maxRedemptions: opts.maxRedemptions,
      expiresAt: new Date(trip.startsAt),
      createdAt: opts.createdAt,
    })
    .returning({ id: tripLastMinutePromos.id });
  if (!deal) throw new Error("deal insert failed");
  return { db, shop, ref: { shopId: shop.id, source: "trip" as const, promoId: deal.id } };
}

/** Reserve `times` uses in turn, each on a fresh attempt; the outcomes in order. */
async function reserveInTurn(
  db: typeof ctx.db,
  ref: { shopId: string; source: "shop" | "trip"; promoId: string },
  times: number,
) {
  const outcomes: string[] = [];
  for (let i = 0; i < times; i++) {
    const intent = await startPaymentOperation(db, {
      shopId: ref.shopId,
      kind: "checkout_session",
    });
    outcomes.push(await reserveDiscountUse(db, { ...ref, intentId: intent.id, now: nowDate() }));
  }
  return outcomes;
}

describe("a trip deal's cap", () => {
  it("is the cap Stripe was given when the deal went out, and tags the trip column", async () => {
    const { db, ref } = await tripDeal({ maxRedemptions: 1, createdAt: nowDate(), capacity: 12 });
    expect(await reserveInTurn(db, ref, 2)).toEqual(["reserved", "used_up"]);
    const tagged = await db
      .select({ tripPromoId: paymentOperationIntents.tripPromoId })
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.tripPromoId, ref.promoId));
    expect(tagged).toHaveLength(1);
  });

  it("reads an uncapped older deal back as the capacity less seats held before it", async () => {
    // Nothing was held before the epoch, so the whole two-seat departure is the cap.
    const { db, ref } = await tripDeal({
      maxRedemptions: null,
      createdAt: new Date(0),
      capacity: 2,
    });
    expect(await reserveInTurn(db, ref, 3)).toEqual(["reserved", "reserved", "used_up"]);
  });

  it("never reads back a cap below one, even when every seat was held before the deal", async () => {
    const { db, ref } = await tripDeal({
      maxRedemptions: null,
      createdAt: new Date("2999-01-01T00:00:00Z"),
      capacity: 1,
    });
    expect(await reserveInTurn(db, ref, 2)).toEqual(["reserved", "used_up"]);
  });
});

describe("a discount that is not this shop's", () => {
  it.each(["shop", "trip"] as const)("has nothing to give (%s)", async (source) => {
    const { db, shop } = ctx;
    const ref = { shopId: shop.id, source, promoId: crypto.randomUUID() };
    expect(await discountCapReached(db, { ...ref, now: nowDate() })).toBe(true);
    expect(await reserveInTurn(db, ref, 1)).toEqual(["used_up"]);
  });
});
