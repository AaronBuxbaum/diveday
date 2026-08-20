import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { cancelBooking } from "./bookings";
import { joinLastMinuteList } from "./last-minute-list";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import {
  getActiveTripPromoByCode,
  listOutstandingLastMinutePromos,
  listTripLastMinutePromos,
  sendLastMinuteDealBlast,
  tripIdsNeverSentLastMinuteDeal,
} from "./trip-promos";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { joinTripWaitlist } from "./waitlist";

const visitor = {
  fullName: "Nora Quinn",
  email: "nora@example.com",
  declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
};

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
      declaration: { level: "open_water" as const, noCertification: false, nitrox: false },
    });

    const provider = fakePromotions();
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 50 },
      provider,
    );
    // The test environment sets neither APP_HOST nor SES_*, so no email
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

    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Wren Ostrowski",
      email: "wren@example.com",
      declaration: { level: "advanced_open_water" as const, noCertification: false, nitrox: false },
    });

    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: fullTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    // The wait-listed diver who meets the requirement gets the code
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

  it("refuses when matching recipients are below the departure's minimum", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Uncertified Diver",
      email: "uncertified@example.com",
      declaration: { noCertification: true, nitrox: false },
    });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );
    expect(outcome).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("supports recipientPersonIds filter to send deals to only selected people", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Selected Diver",
      email: "selected@example.com",
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Unselected Diver",
      email: "unselected@example.com",
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });

    const { people } = await import("./schema");
    const { eq } = await import("drizzle-orm");
    const [person1] = await db
      .select()
      .from(people)
      .where(eq(people.email, "selected@example.com"));

    const outcome = await sendLastMinuteDealBlast(
      db,
      {
        shopId: shop.id,
        shopSlug: "blue-mantis",
        tripId: openTrip.id,
        discountPercent: 25,
        recipientPersonIds: [person1.id],
      },
      fakePromotions(),
    );
    expect(outcome.ok).toBe(true);
    const { listTripLastMinutePromoRecipients } = await import("./trip-promos");
    const sentRecipients = await listTripLastMinutePromoRecipients(db, shop.id, openTrip.id);
    expect(sentRecipients.map((r) => r.email)).toEqual(["selected@example.com"]);
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

describe("listOutstandingLastMinutePromos", () => {
  it("surfaces a sent, unexpired code with its trip so the shop-wide promos page can list it", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const outcome = await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 30 },
      fakePromotions(),
    );
    if (!outcome.ok) throw new Error("expected success");

    // The seeded demo shop already carries its own outstanding deal on a
    // different trip (src/db/seed.ts) — assert this one is present rather
    // than that it's the only row, so the test doesn't depend on the seed's
    // shape.
    const { deals: outstanding } = await listOutstandingLastMinutePromos(db, shop.id);
    expect(outstanding).toContainEqual(
      expect.objectContaining({
        id: outcome.promoId,
        code: outcome.code,
        discountPercent: 30,
        tripId: openTrip.id,
        tripTitle: openTrip.title,
      }),
    );
  });

  it("excludes a failed send — it never discounted anything and has nothing to list", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions({
        async createTripPromotion() {
          return { status: "failed" };
        },
      }),
    );

    const { deals: outstanding } = await listOutstandingLastMinutePromos(db, shop.id);
    expect(outstanding.map((promo) => promo.tripId)).not.toContain(openTrip.id);
  });

  it("excludes a sent code once it has expired — it can no longer discount anything", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 25 },
      fakePromotions(),
    );

    // The code expires at the trip's own departure (docs ADR
    // 20260727-last-minute-fill-promos) — asking "as of after departure"
    // is the same query the diver-facing lookup uses to treat it as dead.
    const afterDeparture = new Date(openTrip.startsAt.getTime() + 1);
    const { deals: outstanding } = await listOutstandingLastMinutePromos(
      db,
      shop.id,
      afterDeparture,
    );
    expect(outstanding.map((promo) => promo.tripId)).not.toContain(openTrip.id);
  });

  it("pages by number and never repeats or skips a deal", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 30 },
      fakePromotions(),
    );

    // The seeded demo shop already carries its own outstanding deal on a
    // different trip, so this is at least two rows without depending on the
    // seed's exact shape.
    const all = await listOutstandingLastMinutePromos(db, shop.id);
    expect(all.pageCount).toBe(1);
    expect(all.deals.length).toBeGreaterThanOrEqual(2);
    expect(all.total).toBe(all.deals.length);

    const seen: string[] = [];
    for (let page = 1; page <= all.total; page++) {
      const chunk = await listOutstandingLastMinutePromos(db, shop.id, undefined, {
        page,
        limit: 1,
      });
      expect(chunk.page).toBe(page);
      expect(chunk.pageCount).toBe(all.total);
      expect(chunk.total).toBe(all.total);
      seen.push(...chunk.deals.map((deal) => deal.id));
    }
    expect(seen).toEqual(all.deals.map((deal) => deal.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("counts only the deals it lists, so an expired one cannot invent a page", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 30 },
      fakePromotions(),
    );

    // A deal expires at its trip's departure, so "after every seeded departure"
    // is a `now` that outlives all of them. The count has to move with the
    // rows, or the pager would promise pages of deals that no longer exist.
    const afterEverything = new Date("2030-01-01T00:00:00.000Z");
    const none = await listOutstandingLastMinutePromos(db, shop.id, afterEverything);
    expect(none.deals).toHaveLength(0);
    expect(none.total).toBe(0);
    expect(none.pageCount).toBe(1);
  });

  it("clamps a nonsensical or out-of-range page rather than showing an empty list", async () => {
    const { db, shop, openTrip } = await context();
    await connectStripe(db, shop.id);
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await sendLastMinuteDealBlast(
      db,
      { shopId: shop.id, shopSlug: "blue-mantis", tripId: openTrip.id, discountPercent: 30 },
      fakePromotions(),
    );

    const first = await listOutstandingLastMinutePromos(db, shop.id, undefined, {
      page: 1,
      limit: 1,
    });
    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await listOutstandingLastMinutePromos(db, shop.id, undefined, {
        page: requested,
        limit: 1,
      });
      expect(clamped.page).toBe(1);
      expect(clamped.deals.map((deal) => deal.id)).toEqual(first.deals.map((deal) => deal.id));
    }

    const past = await listOutstandingLastMinutePromos(db, shop.id, undefined, {
      page: 99,
      limit: 1,
    });
    expect(past.page).toBe(past.pageCount);
    expect(past.deals).toHaveLength(1);
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
