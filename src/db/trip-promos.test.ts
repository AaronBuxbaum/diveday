// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CreateTripPromotionResult, PromotionProvider } from "@/lib/payments/promotions";
import { seededShopContext } from "@/test/db";
import { cancelBooking } from "./bookings";
import { joinLastMinuteList } from "./last-minute-list";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  getActiveTripPromoByCode,
  listTripLastMinutePromos,
  sendLastMinuteDealBlast,
  tripIdsNeverSentLastMinuteDeal,
} from "./trip-promos";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { joinTripWaitlist } from "./waitlist";

function fakePromotions(overrides: Partial<PromotionProvider> = {}): PromotionProvider {
  let counter = 0;
  return {
    async createTripPromotion(): Promise<CreateTripPromotionResult> {
      counter += 1;
      return {
        status: "created",
        stripeCouponId: `coupon_${counter}`,
        stripePromotionCodeId: `promo_${counter}`,
      };
    },
    async createShopPromotion(): Promise<CreateTripPromotionResult> {
      return { status: "failed" };
    },
    ...overrides,
  };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com" };

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const fullTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  const openTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  if (!fullTrip || !openTrip) throw new Error("expected seeded trips missing");
  return { db, shop, fullTrip, openTrip };
}

async function connectStripe(db: Awaited<ReturnType<typeof context>>["db"], shopId: string) {
  await upsertShopStripeAccount(db, shopId, "acct_test");
  await setShopStripeAccountStatus(db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
}

describe("sendLastMinuteDealBlast (in-memory PGlite)", () => {
  it("refuses an out-of-range discount before touching Stripe or the last-minute list", async () => {
    const { db, shop, openTrip } = await context();
    const provider = fakePromotions();
    await expect(
      sendLastMinuteDealBlast(
        db,
        { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 4 },
        provider,
      ),
    ).resolves.toEqual({ ok: false, reason: "invalid_discount" });
  });

  it("refuses a full trip — there is nothing to fill", async () => {
    const { db, shop, fullTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: fullTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(outcome).toEqual({ ok: false, reason: "trip_full" });
  });

  it("refuses when the shop can't accept payments", async () => {
    const { db, shop, openTrip } = await context();
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(outcome).toEqual({ ok: false, reason: "not_connected" });
  });

  it("refuses when no one on the last-minute list is around for this date", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(outcome).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("skips a last-minute-list entry whose date range doesn't cover the trip", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2099-01-01",
      availableUntil: "2099-01-10",
    });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(outcome).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("creates a Stripe coupon + promotion code and emails every matching entry", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Priya Shah",
      email: "priya@example.com",
    });

    const provider = fakePromotions();
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 50 },
      provider,
    );
    // The test environment sets neither APP_HOST nor RESEND_*, so no email
    // actually goes out (same degrade as inviteWaitlistDiver's own test) —
    // this still proves Stripe succeeded, the row landed `sent`, and the
    // matching logic found both entries, independent of email delivery.
    expect(outcome).toMatchObject({ ok: true, recipientCount: 0 });
    if (!outcome.ok) throw new Error("expected success");
    expect(outcome.code).toMatch(/^SAVE50-/);

    const [promo] = await listTripLastMinutePromos(db, shop.id, openTrip.id);
    expect(promo).toMatchObject({
      status: "sent",
      discountPercent: 50,
      code: outcome.code,
      stripeCouponId: "coupon_1",
      stripePromotionCodeId: "promo_1",
      recipientCount: 0,
    });
  });

  it("still finds every matching recipient once a wait-listed diver's trip has an open seat", async () => {
    // The trip was full when this diver joined its wait list, holding "a
    // place in line" — a cancellation just freed the seat the deal is about
    // to advertise to everyone else who's merely around that week too.
    const { db, shop, fullTrip } = await context();
    await connectStripe(db, shop.id);
    const waitlisted = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: fullTrip.id,
      fullName: "Wren Ostrowski",
      email: "wren@example.com",
    });
    if (!waitlisted.ok) throw new Error("expected waitlist join to succeed on a full trip");

    const [toCancel] = await getTripRoster(db, shop.id, fullTrip.id);
    if (!toCancel) throw new Error("expected an existing booking to free a seat");
    await cancelBooking(db, shop.id, toCancel.booking.id);

    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Wren Ostrowski",
      email: "wren@example.com",
    });

    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: fullTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    // Both the wait-listed diver and the unrelated last-minute-list entry
    // still get the code — the reordering (unit-tested directly against
    // orderLastMinuteRecipients in src/lib/last-minute-list.test.ts) changes
    // who hears about it first, never who's included.
    expect(outcome).toMatchObject({ ok: true, recipientCount: 0 });
  });

  it("caps max_redemptions at the trip's open-seat count", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    let seenMaxRedemptions: number | undefined;
    const provider = fakePromotions({
      async createTripPromotion(request) {
        seenMaxRedemptions = request.maxRedemptions;
        return { status: "created", stripeCouponId: "c1", stripePromotionCodeId: "p1" };
      },
    });
    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      provider,
    );
    expect(seenMaxRedemptions).toBe(openTrip.capacity - openTrip.booked);
  });

  it("marks the row failed and sends no email when Stripe rejects the request", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions({
        async createTripPromotion() {
          return { status: "failed" };
        },
      }),
    );
    expect(outcome).toEqual({ ok: false, reason: "stripe_failed" });
    const [promo] = await listTripLastMinutePromos(db, shop.id, openTrip.id);
    expect(promo?.status).toBe("failed");
  });
});

describe("getActiveTripPromoByCode", () => {
  it("resolves a live code scoped to its exact trip", async () => {
    const { db, shop, openTrip, fullTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    if (!outcome.ok) throw new Error("expected success");

    const resolved = await getActiveTripPromoByCode(db, {
      shopId: shop.id,
      tripId: openTrip.id,
      code: outcome.code.toLowerCase(),
    });
    expect(resolved?.id).toBe(outcome.promoId);

    // Same code, wrong trip — never resolves (the whole point of the check).
    expect(
      await getActiveTripPromoByCode(db, {
        shopId: shop.id,
        tripId: fullTrip.id,
        code: outcome.code,
      }),
    ).toBeNull();
  });

  it("does not resolve an expired code", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    if (!outcome.ok) throw new Error("expected success");

    expect(
      await getActiveTripPromoByCode(db, {
        shopId: shop.id,
        tripId: openTrip.id,
        code: outcome.code,
        now: new Date(openTrip.startsAt.getTime() + 1),
      }),
    ).toBeNull();
  });
});

describe("tripIdsNeverSentLastMinuteDeal", () => {
  it("includes a trip until a blast is actually sent for it", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });

    expect(await tripIdsNeverSentLastMinuteDeal(db, shop.id, [openTrip.id])).toEqual(
      new Set([openTrip.id]),
    );

    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );

    expect(await tripIdsNeverSentLastMinuteDeal(db, shop.id, [openTrip.id])).toEqual(new Set());
  });
});
