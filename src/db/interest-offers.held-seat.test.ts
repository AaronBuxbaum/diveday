import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications/kinds";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

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
const { askAnytime } = await import("./interests");
const { bookings, interests, people, trips } = await import("./schema");
const { setShopStripeAccountStatus, upsertShopStripeAccount } = await import("./stripe-accounts");
const { upcomingTripsWithCounts } = await import("./trips");
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

beforeEach(() => {
  vi.mocked(sendNotification).mockReset();
  vi.mocked(sendNotification).mockResolvedValue({ status: "sent", providerMessageId: "m-1" });
});

describe("a held offer rechecks its departure when it fires", () => {
  it.each([
    ["cancelled", { status: "cancelled" as const }],
    ["on a conditions hold", { conditionsHold: true }],
    [
      "already gone",
      { startsAt: new Date("2020-01-01T08:00:00Z"), endsAt: new Date("2020-01-01T12:00:00Z") },
    ],
  ])("offers nobody on a departure %s, and stamps nothing", async (_label, change) => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
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
      interestIds: [own.id],
    });

    expect(outcome.results).toEqual([{ interestId: own.id, delivery: "fallback" }]);
    expect(offered()).toEqual([]);
    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.offeredAt).toBeNull();
  });
});

describe("a seat released as the boat loads", () => {
  // The counter's no-show salvage (e2e check-in, "releases a no-show"): ten
  // minutes past the scheduled time the seat is still the shop's to sell
  // (`hasSailed`, the booking transaction's gate), so the wait list hears.
  it("is offered to the wait list inside the departure's grace", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
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
    const startsAt = new Date(nowDate().getTime() - 10 * 60_000);
    // diveday:allow-flat-revision: a test fixture moving a departure just past its time.
    await db
      .update(trips)
      .set({ startsAt, endsAt: new Date(startsAt.getTime() + 3 * HOUR_MS) })
      .where(eq(trips.id, trip.id));

    await offerSeats(db, {
      shopId: shop.id,
      shopSlug: shop.slug,
      tripId: trip.id,
      interestIds: [own.id],
    });

    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.offeredAt).not.toBeNull();
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
      .insert(interests)
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
      interestIds: [own.id, joined.interestId],
    });

    expect(outcome.results).toEqual([
      { interestId: own.id, delivery: "fallback" },
      { interestId: joined.interestId, delivery: "fallback" },
    ]);
    expect(offered()).toEqual([]);
    const [after] = await db.select().from(interests).where(eq(interests.id, own.id));
    expect(after?.offeredAt).toBeNull();
  });

  it("still offers someone whose seat on it was cancelled", async () => {
    const { db, shop, trip } = await context();
    await askAnytime(db, { shopId: shop.id, ...ana, declaration: openWater });
    const [person] = await db.select().from(people).where(eq(people.email, ana.email));
    if (!person) throw new Error("setup: person missing");
    const [own] = await db
      .insert(interests)
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
      interestIds: [own.id],
    });
    expect(outcome.results).toEqual([{ interestId: own.id, delivery: "sent" }]);
  });
});
