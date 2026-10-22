import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";

const ctx = fileScopedShopContext();

/**
 * **The deal is an offer with a discount** (ADR 20261017-one-lead-with-a-scope).
 * The send is captured and the app origin pinned (as `lead-offers.delivery.test`
 * does), so these pin what is written and what would leave: the promo row
 * before Stripe, the departure rows after it, the lead's own unsubscribe link,
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
const { offerSeats } = await import("./lead-offers");
const { askAnytime, resolveLeadUnsubscribeToken } = await import("./leads");
const { leads, people, tripLastMinutePromos } = await import("./schema");
const { setShopStripeAccountStatus, upsertShopStripeAccount } = await import("./stripe-accounts");
const { upcomingTripsWithCounts } = await import("./trips");

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
        const rows = await db.select().from(leads).where(eq(leads.promoId, request.idempotencyKey));
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
        leadIds: [joined.leadId],
        discount: { percent: 25 },
      },
      undefined,
      promotions,
    );

    // Pending when Stripe was asked, and no departure row carried the deal yet.
    expect(seenAtStripe).toEqual({ status: "pending", departureRows: 0 });
    expect(outcome.deal).toMatchObject({ ok: true, recipientCount: 1 });
    if (!outcome.deal?.ok) throw new Error("expected the deal to go");

    // The child row: a shop-asked departure copy of the anytime lead, carrying the deal.
    const [child] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.scope, "departure"), eq(leads.tripId, trip.id)));
    expect(child).toMatchObject({
      askedBy: "shop",
      parentLeadId: joined.leadId,
      promoId: outcome.deal.promoId,
    });
    expect(child?.offeredAt).not.toBeNull();
    // The list lead itself is untouched: still open, still the diver's.
    const [parent] = await db.select().from(leads).where(eq(leads.id, joined.leadId));
    expect(parent).toMatchObject({ scope: "anytime", closedAt: null, promoId: null });

    // The mail says the deal, and its way out is the list's own link.
    const [mail] = offered();
    expect(mail?.kind).toBe("seat_offer_commercial");
    if (mail?.kind !== "seat_offer_commercial") return;
    expect(mail).toMatchObject({ code: outcome.deal.code, discountPercent: 25 });
    expect(mail.expiresAt).toEqual(trip.startsAt);
    const token = mail.unsubscribeUrl.split("/unsubscribe/")[1] ?? "";
    expect(await resolveLeadUnsubscribeToken(db, token)).toMatchObject({ leadId: joined.leadId });
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
      .insert(leads)
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
        leadIds: [taken.leadId, free.leadId],
        discount: { percent: 25 },
      },
      undefined,
      fakePromotions(),
    );

    expect(outcome.deal).toMatchObject({ ok: true, recipientCount: 1 });
    expect(outcome.results).toEqual([
      { leadId: taken.leadId, delivery: "already_sent" },
      { leadId: free.leadId, delivery: "sent" },
    ]);
    // Her row is exactly as it was: no deal stamped on it, window not slid.
    const [after] = await db.select().from(leads).where(eq(leads.id, existing.id));
    expect(after?.promoId).toBeNull();
    expect(after?.emailedAt).toEqual(hourAgo);
    expect(offered()).toHaveLength(1);
  });

  it("offers an anytime lead below the departure's bar to nobody, whatever was posted", async () => {
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
      leadIds: [uncertified.leadId],
    });

    expect(outcome.results).toEqual([{ leadId: uncertified.leadId, delivery: "fallback" }]);
    expect(offered()).toHaveLength(0);
    const rows = await db.select().from(leads).where(eq(leads.scope, "departure"));
    expect(rows.filter((row) => row.parentLeadId === uncertified.leadId)).toEqual([]);
  });

  it("offers a list lead without a discount as an ordinary commercial offer, no promo written", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...nora, declaration: openWater });
    const promosBefore = (await db.select().from(tripLastMinutePromos)).length;

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      leadIds: [joined.leadId],
    });

    expect(outcome.deal).toBeUndefined();
    expect(outcome.results).toEqual([{ leadId: joined.leadId, delivery: "sent" }]);
    const [mail] = offered();
    expect(mail?.kind).toBe("seat_offer_commercial");
    if (mail?.kind !== "seat_offer_commercial") return;
    expect(mail.code).toBeUndefined();
    expect(await db.select().from(tripLastMinutePromos)).toHaveLength(promosBefore);
  });
});
