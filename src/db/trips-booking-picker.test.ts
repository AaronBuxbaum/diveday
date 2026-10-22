import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { DEPARTURE_BUFFER_MS } from "@/lib/trips";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { boats, bookings, people, shops, trips } from "./schema";
import { offsetUpcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
const START = new Date("2031-01-01T12:00:00Z");

async function departures(count: number) {
  const { db, shop } = ctx;
  return db
    .insert(trips)
    .values(
      Array.from({ length: count }, (_, index) => ({
        shopId: shop.id,
        title: `Picker departure ${String(index + 1).padStart(3, "0")}`,
        startsAt: new Date(START.getTime() + index * 3_600_000),
        endsAt: new Date(START.getTime() + (index + 1) * 3_600_000),
        capacity: 2,
      })),
    )
    .returning();
}

async function selectedPerson() {
  const [person] = await ctx.db
    .select()
    .from(people)
    .where(eq(people.shopId, ctx.shop.id))
    .limit(1);
  if (!person) throw new Error("the seeded shop has no person");
  return person.id;
}

function pageFor(personId: string, page = 1, limit = 50) {
  return offsetUpcomingTripsWithCounts(ctx.db, ctx.shop.id, {
    hasSpace: true,
    excludeBookedForPersonId: personId,
    now: START,
    page,
    limit,
  });
}

describe("the diver record's bounded departure picker", () => {
  it("finds departure 51 after 50 full or already-booked departures before applying the limit", async () => {
    const { db, shop } = ctx;
    const personId = await selectedPerson();
    const created = await departures(51);
    await db.insert(bookings).values(
      created.slice(0, 50).map((trip) => ({
        shopId: shop.id,
        tripId: trip.id,
        personId,
        bookedAs: "diver" as const,
      })),
    );
    for (const trip of created.slice(0, 25)) {
      await db.update(trips).set({ capacity: 1 }).where(eq(trips.id, trip.id));
    }

    const first = await pageFor(personId);
    expect(first.trips.map((trip) => trip.id)).toEqual([created[50]?.id]);
    expect(first.total).toBe(1);
    expect(first.pageCount).toBe(1);
  });

  it("returns a genuinely empty result when the diver is already on every open departure", async () => {
    const { db, shop } = ctx;
    const personId = await selectedPerson();
    const created = await departures(3);
    await db.insert(bookings).values(
      created.map((trip) => ({
        shopId: shop.id,
        tripId: trip.id,
        personId,
        bookedAs: "diver" as const,
      })),
    );
    const empty = await pageFor(personId);
    expect(empty.trips).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.pageCount).toBe(1);
  });

  it("offers cancelled and future no-show bookings again, but excludes a no-show once its departure starts", async () => {
    const { db, shop } = ctx;
    const personId = await selectedPerson();
    const [cancelled, absent] = await departures(2);
    if (!cancelled || !absent) throw new Error("departures missing");
    await db.insert(bookings).values([
      { shopId: shop.id, tripId: cancelled.id, personId, bookedAs: "diver", status: "cancelled" },
      { shopId: shop.id, tripId: absent.id, personId, bookedAs: "diver", status: "no_show" },
    ]);
    expect((await pageFor(personId)).trips.map((trip) => trip.id)).toEqual([
      cancelled.id,
      absent.id,
    ]);
    advanceClock(absent.startsAt.getTime() - nowMs());
    const started = await pageFor(personId);
    expect(started.trips.map((trip) => trip.id)).toEqual([cancelled.id]);
    expect(started.total).toBe(1);
  });

  it("pages only matching departures, with an exact count and no gaps", async () => {
    const personId = await selectedPerson();
    const created = await departures(5);
    const pages = [];
    for (let page = 1; page <= 3; page++) {
      const result = await pageFor(personId, page, 2);
      expect(result.trips.length).toBeLessThanOrEqual(2);
      expect(result.total).toBe(5);
      expect(result.pageCount).toBe(3);
      pages.push(...result.trips.map((trip) => trip.id));
    }
    expect(pages).toEqual(created.map((trip) => trip.id));
    expect((await pageFor(personId, 999, 2)).page).toBe(3);
    expect((await pageFor(personId, Number.NaN, 2)).page).toBe(1);
  });

  it("preserves the record's departure grace at its existing inclusive boundary in both rows and count", async () => {
    const { db, shop } = ctx;
    const personId = await selectedPerson();
    const created = await db
      .insert(trips)
      .values(
        [-DEPARTURE_BUFFER_MS - 1, -DEPARTURE_BUFFER_MS, -DEPARTURE_BUFFER_MS + 1, 0].map(
          (offset) => ({
            shopId: shop.id,
            title: `Grace ${offset}`,
            startsAt: new Date(START.getTime() + offset),
            endsAt: new Date(START.getTime() + DEPARTURE_BUFFER_MS),
            capacity: 2,
          }),
        ),
      )
      .returning();
    const result = await offsetUpcomingTripsWithCounts(db, shop.id, {
      hasSpace: true,
      excludeBookedForPersonId: personId,
      includeDepartureBuffer: true,
      now: START,
      limit: 10,
    });
    expect(result.trips.map((trip) => trip.id)).toEqual(created.slice(1).map((trip) => trip.id));
    expect(result.total).toBe(3);
  });

  it("respects the boat certificate and excludes cancelled and deleted trips", async () => {
    const { db, shop } = ctx;
    const personId = await selectedPerson();
    const [full, calledOff, removed, open] = await departures(4);
    if (!full || !calledOff || !removed || !open) throw new Error("departures missing");
    const [boat] = await db
      .insert(boats)
      .values({
        shopId: shop.id,
        name: "Certified picker hull",
        capacity: 2,
        certifiedPassengers: 1,
      })
      .returning();
    if (!boat) throw new Error("boat missing");
    await db.update(trips).set({ boatId: boat.id }).where(eq(trips.id, full.id));
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: full.id, personId, bookedAs: "diver" });
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, calledOff.id));
    await db.update(trips).set({ deletedAt: START }).where(eq(trips.id, removed.id));
    expect((await pageFor(personId)).trips.map((trip) => trip.id)).toEqual([open.id]);
  });

  it("cannot reveal another shop's departures when given that shop's diver identity", async () => {
    const { db, shop } = ctx;
    const [foreignShop] = await db
      .insert(shops)
      .values({ name: "Other picker shop", slug: "other-picker-shop", timezone: "UTC" })
      .returning();
    if (!foreignShop) throw new Error("foreign shop missing");
    const [foreignPerson] = await db
      .insert(people)
      .values({
        shopId: foreignShop.id,
        fullName: "Other diver",
        email: "other-picker@example.test",
      })
      .returning();
    if (!foreignShop || !foreignPerson) throw new Error("foreign fixture missing");
    const [ownTrip] = await departures(1);
    if (!ownTrip) throw new Error("own departure missing");
    const [foreignTrip] = await db
      .insert(trips)
      .values({
        shopId: foreignShop.id,
        title: "Foreign departure",
        startsAt: START,
        endsAt: new Date(START.getTime() + 3_600_000),
        capacity: 2,
      })
      .returning();
    if (!foreignTrip) throw new Error("foreign departure missing");
    await db.insert(bookings).values({
      shopId: foreignShop.id,
      tripId: foreignTrip.id,
      personId: foreignPerson.id,
      bookedAs: "diver",
    });
    const own = await pageFor(foreignPerson.id);
    expect(own.trips.map((trip) => trip.id)).toEqual([ownTrip.id]);
    expect(own.trips.every((trip) => trip.shopId === shop.id)).toBe(true);
    expect(own.total).toBe(1);
  });
});
