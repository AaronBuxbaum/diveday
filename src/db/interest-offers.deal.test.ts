import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";

const ctx = fileScopedShopContext();

/**
 * **The deal is an offer with a discount** (ADR 20261017-one-interest-with-a-scope).
 * The send is captured and the app origin pinned (as `interest-offers.delivery.test`
 * does), so these pin what is written and what would leave: the promo row
 * before Stripe, the departure rows after it, the interest's own unsubscribe link,
 * and the 24-hour cold-send window a deal skips rather than fails on.
 */
vi.mock("./notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./notifications")>();
  return { ...actual, sendNotification: vi.fn() };
});
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: () => "https://dive.day" };
});

const { sendNotification } = await import("./notifications");
const { offerSeats } = await import("./interest-offers");
const { createBoat } = await import("./boats");
const { askAnytime, resolveInterestUnsubscribeToken } = await import("./interests");
const { interests, people, tripLastMinutePromos } = await import("./schema");
const { setShopStripeAccountStatus, upsertShopStripeAccount } = await import("./stripe-accounts");
const { trips } = await import("./schema");
const { listStaff, setTripCrew, upcomingTripsWithCounts } = await import("./trips");

const nora = { fullName: "Nora Quinn", email: "nora@example.com" };
const priya = { fullName: "Priya Shah", email: "priya@example.com" };
const openWater = { level: "open_water" as const, noCertification: false, nitrox: false };

async function context() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  await upsertShopStripeAccount(db, shop.id, "acct_deal_test");
  await setShopStripeAccountStatus(db, "acct_deal_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop, trip };
}

function offered(): Notification[] {
  return vi.mocked(sendNotification).mock.calls.map((call) => call[1]);
}

describe("offerSeats with a discount", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockReset();
    vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
  });

  it("writes the promo pending before Stripe, then a departure row per diver, then sends", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...nora, declaration: openWater });
    let seenAtStripe: { status: string | undefined; departureRows: number } | null = null;
    const promotions = fakePromotions({
      async createTripPromotion(request) {
        // The idempotency key is the promo row's own id.
        const [promo] = await db
          .select()
          .from(tripLastMinutePromos)
          .where(eq(tripLastMinutePromos.id, request.idempotencyKey));
        const rows = await db
          .select()
          .from(interests)
          .where(eq(interests.promoId, request.idempotencyKey));
        seenAtStripe = { status: promo?.status, departureRows: rows.length };
        return { status: "created", stripeCouponId: "coupon_x", stripePromotionCodeId: "promo_x" };
      },
    });

    const outcome = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [joined.interestId],
        discount: { percent: 25 },
      },
      undefined,
      promotions,
    );

    // Pending when Stripe was asked, and no departure row carried the deal yet.
    expect(seenAtStripe).toEqual({ status: "pending", departureRows: 0 });
    expect(outcome.deal).toMatchObject({ ok: true, recipientCount: 1 });
    if (!outcome.deal?.ok) throw new Error("expected the deal to go");

    // The child row: a shop-asked departure copy of the anytime interest, carrying the deal.
    const [child] = await db
      .select()
      .from(interests)
      .where(and(eq(interests.scope, "departure"), eq(interests.tripId, trip.id)));
    expect(child).toMatchObject({
      askedBy: "shop",
      parentInterestId: joined.interestId,
      promoId: outcome.deal.promoId,
    });
    expect(child?.offeredAt).not.toBeNull();
    // The list interest itself is untouched: still open, still the diver's.
    const [parent] = await db.select().from(interests).where(eq(interests.id, joined.interestId));
    expect(parent).toMatchObject({ scope: "anytime", closedAt: null, promoId: null });

    // The mail says the deal, and its way out is the list's own link.
    const [mail] = offered();
    expect(mail?.kind).toBe("seat_offer_commercial");
    if (mail?.kind !== "seat_offer_commercial") return;
    expect(mail).toMatchObject({ code: outcome.deal.code, discountPercent: 25 });
    expect(mail.expiresAt).toEqual(trip.startsAt);
    const token = mail.unsubscribeUrl.split("/unsubscribe/")[1] ?? "";
    expect(await resolveInterestUnsubscribeToken(db, token)).toMatchObject({
      interestId: joined.interestId,
    });
  });

  it("caps promo redemptions at the boat's passenger places after assigned crew reserves seats", async () => {
    const { db, shop, trip } = await context();
    const boat = await createBoat(db, shop.id, "Eight aboard", 8);
    await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, trip.id));
    const staff = await listStaff(db, shop.id);
    expect(staff.length).toBeGreaterThanOrEqual(2);
    expect(
      await setTripCrew(
        db,
        shop.id,
        trip.id,
        staff.slice(0, 2).map(({ person }) => person.id),
      ),
    ).toBe(true);
    const joined = await askAnytime(db, { shopId: shop.id, ...nora, declaration: openWater });

    const outcome = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [joined.interestId],
        discount: { percent: 25 },
      },
      undefined,
      fakePromotions(),
    );

    expect(outcome.deal).toMatchObject({ ok: true, recipientCount: 1 });
    if (!outcome.deal?.ok) throw new Error("expected the deal to go");
    const [promo] = await db
      .select()
      .from(tripLastMinutePromos)
      .where(eq(tripLastMinutePromos.id, outcome.deal.promoId));
    expect(promo?.maxRedemptions).toBe(Math.max(0, Math.min(trip.capacity, 8 - 2) - trip.booked));
  });

  it("skips a diver whose row already took the 24-hour window, and still sends the rest", async () => {
    const { db, shop, trip } = await context();
    const taken = await askAnytime(db, { shopId: shop.id, ...nora, declaration: openWater });
    const free = await askAnytime(db, { shopId: shop.id, ...priya, declaration: openWater });
    // Nora was cold-emailed about this very departure an hour ago.
    const [noraPerson] = await db.select().from(people).where(eq(people.email, nora.email));
    if (!noraPerson) throw new Error("setup: person missing");
    const hourAgo = new Date(nowDate().getTime() - HOUR_MS);
    const [existing] = await db
      .insert(interests)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "shop",
        tripId: trip.id,
        personId: noraPerson.id,
        partySize: 1,
        offeredAt: hourAgo,
        emailedAt: hourAgo,
      })
      .returning();
    if (!existing) throw new Error("setup: row missing");

    const outcome = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [taken.interestId, free.interestId],
        discount: { percent: 25 },
      },
      undefined,
      fakePromotions(),
    );

    expect(outcome.deal).toMatchObject({ ok: true, recipientCount: 1 });
    expect(outcome.results).toEqual([
      { interestId: taken.interestId, delivery: "already_sent" },
      { interestId: free.interestId, delivery: "sent" },
    ]);
    // Her row is exactly as it was: no deal stamped on it, window not slid.
    const [after] = await db.select().from(interests).where(eq(interests.id, existing.id));
    expect(after?.promoId).toBeNull();
    expect(after?.emailedAt).toEqual(hourAgo);
    expect(offered()).toHaveLength(1);
  });

  it("offers an anytime interest below the departure's bar to nobody, whatever was posted", async () => {
    const { db, shop, trip } = await context();
    const uncertified = await askAnytime(db, {
      shopId: shop.id,
      fullName: "Uncertified Diver",
      email: "uncertified@example.com",
      declaration: { noCertification: true, nitrox: false },
    });

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [uncertified.interestId],
    });

    expect(outcome.results).toEqual([{ interestId: uncertified.interestId, delivery: "fallback" }]);
    expect(offered()).toHaveLength(0);
    const rows = await db.select().from(interests).where(eq(interests.scope, "departure"));
    expect(rows.filter((row) => row.parentInterestId === uncertified.interestId)).toEqual([]);
  });

  it("offers a list interest without a discount as an ordinary commercial offer, no promo written", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...nora, declaration: openWater });
    const promosBefore = (await db.select().from(tripLastMinutePromos)).length;

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [joined.interestId],
    });

    expect(outcome.deal).toBeUndefined();
    expect(outcome.results).toEqual([{ interestId: joined.interestId, delivery: "sent" }]);
    const [mail] = offered();
    expect(mail?.kind).toBe("seat_offer_commercial");
    if (mail?.kind !== "seat_offer_commercial") return;
    expect(mail.code).toBeUndefined();
    expect(await db.select().from(tripLastMinutePromos)).toHaveLength(promosBefore);
  });
});

/**
 * **A rehearsal's offers never leave** (ADR 20261012-rehearsal-departures,
 * `src/db/rehearsal-coverage.test.ts`'s gate on this file). A departure made a
 * rehearsal while the send was held offers nobody, with or without a deal:
 * Stripe is never asked, no promo or departure row is written, no mail goes.
 */
describe("offerSeats on a rehearsal", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockReset();
    vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
  });

  it.each([
    ["without a discount", undefined],
    ["with a discount", { percent: 25 }],
  ])("offers nobody %s", async (_label, discount) => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...nora, declaration: openWater });
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, trip.id));
    const promosBefore = (await db.select().from(tripLastMinutePromos)).length;
    const stripeCalls: string[] = [];
    const promotions = fakePromotions({
      async createTripPromotion(request) {
        stripeCalls.push(request.idempotencyKey);
        return { status: "created", stripeCouponId: "coupon_x", stripePromotionCodeId: "promo_x" };
      },
    });

    const outcome = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        interestIds: [joined.interestId],
        discount,
      },
      undefined,
      promotions,
    );

    expect(outcome.deal?.ok ?? false).toBe(false);
    expect(outcome.results.every((result) => result.delivery !== "sent")).toBe(true);
    expect(stripeCalls).toEqual([]);
    expect(offered()).toHaveLength(0);
    expect(await db.select().from(tripLastMinutePromos)).toHaveLength(promosBefore);
    const rows = await db
      .select()
      .from(interests)
      .where(and(eq(interests.scope, "departure"), eq(interests.tripId, trip.id)));
    expect(rows).toEqual([]);
  });
});
