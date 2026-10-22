import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";
import { fakePromotions } from "@/test/fakes";

const ctx = fileScopedShopContext();

/**
 * **What a later offer owes an earlier answer** (security and dive-domain
 * reviews of #2656). The send is captured and the app origin pinned, as
 * `lead-offers.deal.test` does, so these pin what would leave:
 *
 * - an unsubscribe from the last-minute list stops the offers that list made
 *   possible, and an offer on a diver's own row carries a way out that works
 *   (security MAJOR 1);
 * - a deal blast neither re-parents a diver's own wait-list row nor drops the
 *   seats an earlier offer on it holds (dive-domain M3), and forty deal rows do
 *   not count against a three-seat boat (R2, M2);
 * - the held send rechecks the departure when it fires (dive-domain m3).
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
const { invitableSeats, offerSeats } = await import("./lead-offers");
const { askAnytime, unsubscribeAnytimeLeadByToken } = await import("./leads");
const { optOutPersonFromCourtesyEmailByToken, resolveCourtesyEmailUnsubscribeToken } = await import(
  "./courtesy-email"
);
const { bookings, leads, people, tripLastMinutePromos, trips } = await import("./schema");
const { setShopStripeAccountStatus, upsertShopStripeAccount } = await import("./stripe-accounts");
const { createTrip, upcomingTripsWithCounts } = await import("./trips");

const ana = { fullName: "Ana Reyes", email: "ana@example.com" };
const openWater = { level: "open_water" as const, noCertification: false, nitrox: false };

async function context() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("expected seeded trip missing");
  await upsertShopStripeAccount(db, shop.id, "acct_optout_test");
  await setShopStripeAccountStatus(db, "acct_optout_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop, trip };
}

function offered(): Notification[] {
  return vi.mocked(sendNotification).mock.calls.map((call) => call[1]);
}

function tokenOf(mail: Notification | undefined): string {
  if (mail?.kind !== "seat_offer_commercial") throw new Error("expected a commercial offer");
  return mail.unsubscribeUrl.split("/unsubscribe/")[1] ?? "";
}

async function tripRow(db: (typeof ctx)["db"], tripId: string) {
  const [row] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!row) throw new Error("trip missing");
  return row;
}

/** Moves a row's last email out of the 24-hour window, as a day passing would. */
async function aDayLater(db: (typeof ctx)["db"], leadId: string) {
  const longAgo = new Date(nowDate().getTime() - 25 * HOUR_MS);
  await db
    .update(leads)
    .set({ emailedAt: longAgo, offeredAt: longAgo })
    .where(eq(leads.id, leadId));
}

beforeEach(() => {
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
});

describe("an unsubscribe from the last-minute list", () => {
  it("stops a later offer on the departure row that list's deal made", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const deal = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        leadIds: [joined.leadId],
        discount: { percent: 20 },
      },
      undefined,
      fakePromotions(),
    );
    expect(deal.results).toEqual([{ leadId: joined.leadId, delivery: "sent" }]);
    expect(await unsubscribeAnytimeLeadByToken(db, { token: tokenOf(offered()[0]) })).not.toBeNull();
    const [child] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.parentLeadId, joined.leadId), eq(leads.tripId, trip.id)));
    if (!child) throw new Error("setup: departure row missing");
    await aDayLater(db, child.id);
    vi.mocked(sendNotification).mockClear();

    const later = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      leadIds: [child.id],
    });

    expect(later.results).toEqual([{ leadId: child.id, delivery: "opted_out" }]);
    expect(offered()).toEqual([]);
  });

  it("does not point a diver's own wait-list row at the list, and its way out works", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(leads)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");

    await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        leadIds: [joined.leadId],
        discount: { percent: 20 },
      },
      undefined,
      fakePromotions(),
    );

    const [after] = await db.select().from(leads).where(eq(leads.id, own.id));
    expect(after?.parentLeadId).toBeNull();
    // The deal went out on her own row, so its link is her own way out of
    // commercial mail, and using it stops the next offer on that row.
    const token = tokenOf(offered()[0]);
    expect(await resolveCourtesyEmailUnsubscribeToken(db, token)).toMatchObject({
      personId: person.id,
    });
    await optOutPersonFromCourtesyEmailByToken(db, { token });
    await aDayLater(db, own.id);
    vi.mocked(sendNotification).mockClear();

    const later = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      leadIds: [own.id],
    });
    expect(later.results).toEqual([{ leadId: own.id, delivery: "opted_out" }]);
    expect(offered()).toEqual([]);
  });
});

describe("invitableSeats and the deal", () => {
  it("keeps the seats a wait-list invite holds after a deal reaches the same diver", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    // Ana and her buddy were offered on Wednesday, without a deal.
    const wednesday = new Date(nowDate().getTime() - 26 * HOUR_MS);
    await db.insert(leads).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      personId: person.id,
      partySize: 2,
      offeredAt: wednesday,
      emailedAt: wednesday,
    });
    const before = await invitableSeats(db, await tripRow(db, trip.id));
    const [anytime] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.scope, "anytime"), eq(leads.personId, person.id)));
    if (!anytime) throw new Error("setup: anytime lead missing");

    // Thursday, staff send a deal that reaches her through the list.
    const deal = await offerSeats(
      db,
      {
        shopId: shop.id,
        shopSlug: shop.slug,
        tripId: trip.id,
        leadIds: [anytime.id],
        discount: { percent: 15 },
      },
      undefined,
      fakePromotions(),
    );
    expect(deal.deal).toMatchObject({ ok: true });

    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(before);
  });

  // ADR 20261017-one-lead-with-a-scope, R2.
  it("does not count forty deal rows against a three-seat departure", async () => {
    const { db, shop, trip: seeded } = await context();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Three-seat charter",
      startsAt: seeded.startsAt,
      endsAt: seeded.endsAt,
      capacity: 3,
      plannedDives: 2,
    });
    if (!trip) throw new Error("setup: trip failed");
    const [promo] = await db
      .insert(tripLastMinutePromos)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        code: "LASTMIN-R2",
        discountPercent: 20,
        expiresAt: trip.startsAt,
        status: "sent",
      })
      .returning();
    if (!promo) throw new Error("setup: promo failed");
    const crowd = await db
      .insert(people)
      .values(
        Array.from({ length: 41 }, (_, index) => ({
          shopId: shop.id,
          fullName: `Listed Diver ${index}`,
          email: `listed-${index}@example.com`,
        })),
      )
      .returning({ id: people.id });
    const [waiter, ...listed] = crowd;
    if (!waiter) throw new Error("setup: people failed");
    const parents = await db
      .insert(leads)
      .values(
        listed.map((person) => ({ shopId: shop.id, scope: "anytime" as const, askedBy: "diver" as const, personId: person.id })),
      )
      .returning({ id: leads.id, personId: leads.personId });
    const now = nowDate();
    await db.insert(leads).values(
      parents.map((parent) => ({
        shopId: shop.id,
        scope: "departure" as const,
        askedBy: "shop" as const,
        tripId: trip.id,
        personId: parent.personId,
        parentLeadId: parent.id,
        partySize: 1,
        promoId: promo.id,
        offeredAt: now,
        emailedAt: now,
      })),
    );
    await db.insert(leads).values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      personId: waiter.id,
      partySize: 2,
      offeredAt: now,
      emailedAt: now,
    });

    expect(await invitableSeats(db, await tripRow(db, trip.id))).toBe(1);
  });
});

describe("a held offer rechecks its departure when it fires", () => {
  it.each([
    ["cancelled", { status: "cancelled" as const }],
    ["on a conditions hold", { conditionsHold: true }],
    ["already gone", { startsAt: new Date("2020-01-01T08:00:00Z"), endsAt: new Date("2020-01-01T12:00:00Z") }],
  ])("offers nobody on a departure %s, and stamps nothing", async (_label, change) => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(leads)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    // diveday:allow-flat-revision: a test fixture moving a departure into the past.
    await db.update(trips).set(change).where(eq(trips.id, trip.id));

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      leadIds: [own.id],
    });

    expect(outcome.results).toEqual([{ leadId: own.id, delivery: "fallback" }]);
    expect(offered()).toEqual([]);
    const [after] = await db.select().from(leads).where(eq(leads.id, own.id));
    expect(after?.offeredAt).toBeNull();
  });
});

describe("an offer to someone already aboard", () => {
  // Coordinator's follow-up to the #2656 reviews: the panel hides a seated
  // diver, but a hand-posted id is read on the server, so it is filtered there.
  it("offers nobody who holds a seat on the departure, by their row or by the list", async () => {
    const { db, shop, trip } = await context();
    const joined = await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(leads)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
    });

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      leadIds: [own.id, joined.leadId],
    });

    expect(outcome.results).toEqual([
      { leadId: own.id, delivery: "fallback" },
      { leadId: joined.leadId, delivery: "fallback" },
    ]);
    expect(offered()).toEqual([]);
    const [after] = await db.select().from(leads).where(eq(leads.id, own.id));
    expect(after?.offeredAt).toBeNull();
  });

  it("still offers someone whose seat on it was cancelled", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(leads)
      .values({
        shopId: shop.id,
        scope: "departure",
        askedBy: "diver",
        tripId: trip.id,
        personId: person.id,
        partySize: 1,
      })
      .returning();
    if (!own) throw new Error("setup: wait-list row missing");
    await db.insert(bookings).values({
      bookedAs: "diver",
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
      status: "cancelled",
    });

    const outcome = await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      leadIds: [own.id],
    });
    expect(outcome.results).toEqual([{ leadId: own.id, delivery: "sent" }]);
  });
});
