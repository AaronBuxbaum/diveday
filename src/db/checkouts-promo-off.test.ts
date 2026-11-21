import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout, fakePromotions } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { startBookingCheckout } from "./checkouts";
import { createShopPromoCode } from "./shop-promos";
import { setShopPassThroughFee } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { editTrip } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

/**
 * **What a percent code took off, recorded per checkout** (#4863). The
 * promotions report reads this one figure, so it must match what Stripe was
 * told: the seats alone when a fixed coupon spares the park fee, the gross when
 * the coupon fails and the percent code goes out as it is.
 */
const ctx = fileScopedShopContext();

async function discountOff(feeCents: number, promotions: ReturnType<typeof fakePromotions>) {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  await editTrip(db, shop.id, reef.id, {
    title: reef.title,
    startsAt: reef.startsAt,
    endsAt: reef.endsAt,
    capacity: reef.capacity,
    plannedDives: reef.plannedDives,
    priceCents: 18_000,
  });
  await setShopPassThroughFee(db, shop.id, { name: "Park fee", amountCents: feeCents });
  const party = await createBookingParty(
    db,
    ["Pia Percent", "Pat Percent"].map((fullName) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName,
      email: `off-${crypto.randomUUID()}@example.com`,
    })),
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const code = await createShopPromoCode(
    db,
    {
      shopId: shop.id,
      code: `TEN${crypto.randomUUID().slice(0, 6)}`,
      discountPercent: 10,
      scope: "all",
    },
    fakePromotions(),
  );
  if (!code.ok) throw new Error("percent promo failed");
  const start = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: party.bookings.map((b) => b.bookingId),
      customerEmail: "pia@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }) => tripTitle,
      promotionCode: code.promo.stripePromotionCodeId ?? undefined,
      shopPromo: {
        id: code.promo.id,
        code: code.promo.code,
        discountPercent: code.promo.discountPercent,
        discountAmountCents: code.promo.discountAmountCents,
      },
    },
    fakeCheckout(),
    promotions,
  );
  if (!start.ok) throw new Error("checkout start failed");
  return start.checkout.discountOffCents;
}

describe("a percent code's recorded discount", () => {
  it("is the percent of the seats alone when the fixed coupon guards the park fee", async () => {
    // Two seats at $180 and two $15 fees: 10% of $360, not of $390.
    expect(
      await discountOff(
        1_500,
        fakePromotions({
          async createSessionDiscount() {
            return { status: "created", stripeCouponId: "coupon_session" };
          },
        }),
      ),
    ).toBe(3_600);
  });

  it("is the percent of the gross when the coupon fails and Stripe gets the code", async () => {
    expect(
      await discountOff(
        1_500,
        fakePromotions({
          async createSessionDiscount() {
            return { status: "not_configured" };
          },
        }),
      ),
    ).toBe(3_900);
  });

  it("is the percent of the seats with no fee", async () => {
    expect(await discountOff(0, fakePromotions())).toBe(3_600);
  });
});
