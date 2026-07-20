// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, tripRequirements } from "./schema";
import {
  createTrip,
  createTripSeries,
  getTripSeriesSummary,
  getTripWithBooked,
  listTripDives,
  setTripStatus,
  upcomingTripsWithCounts,
  updateTrip,
} from "./trips";

describe("demo seed + schedule queries (in-memory PGlite)", () => {
  it("returns upcoming trips ordered by start with correct booked counts", async () => {
    const { db, shop } = await seededShopContext();

    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    expect(upcoming).toHaveLength(12);

    const starts = upcoming.map((t) => t.startsAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));

    const bySlugishTitle = Object.fromEntries(upcoming.map((t) => [t.title, t.booked]));
    expect(bySlugishTitle["Two-Tank Reef — Molasses & French"]).toBe(9);
    expect(bySlugishTitle["Wreck Trip — Spiegel Grove"]).toBe(10);
    expect(bySlugishTitle["Two-Tank Reef — Christ of the Abyss"]).toBe(0);
    expect(
      upcoming.find((trip) => trip.title === "Discover Scuba — Pool & Reef")?.course?.title,
    ).toBe("Discover Scuba Diving");
    // The seeded Open Water session is what the public course page books into.
    expect(
      upcoming.find((trip) => trip.title === "Open Water Diver — three-day course")?.course?.title,
    ).toBe("Open Water Diver");
  });

  it("frees the spot when a booking is cancelled", async () => {
    const { db, shop } = await seededShopContext();

    const before = await upcomingTripsWithCounts(db, shop.id);
    const wreck = before.find((t) => t.title === "Wreck Trip — Spiegel Grove");
    if (!wreck) throw new Error("wreck trip missing");
    expect(wreck.booked).toBe(wreck.capacity); // seeded sold out

    const [first] = await db.select().from(bookings).limit(1);
    if (!first) throw new Error("no bookings seeded");
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.id));

    const after = await upcomingTripsWithCounts(db, shop.id);
    const total = (rows: typeof after) => rows.reduce((sum, t) => sum + t.booked, 0);
    expect(total(after)).toBe(total(before) - 1);
  });

  it("stores an optional per-diver price and lets staff update or clear it", async () => {
    const { db, shop } = await seededShopContext();

    const unpriced = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — no price yet",
      startsAt: new Date("2030-08-01T13:00:00.000Z"),
      endsAt: new Date("2030-08-01T17:00:00.000Z"),
      capacity: 10,
    });
    if (!unpriced) throw new Error("trip not created");
    expect(unpriced.priceCents).toBeNull();

    const priced = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — priced",
      startsAt: new Date("2030-08-02T13:00:00.000Z"),
      endsAt: new Date("2030-08-02T17:00:00.000Z"),
      capacity: 10,
      priceCents: 18_000,
    });
    if (!priced) throw new Error("trip not created");
    expect(priced.priceCents).toBe(18_000);

    await updateTrip(db, shop.id, priced.id, {
      title: priced.title,
      startsAt: priced.startsAt,
      endsAt: priced.endsAt,
      capacity: priced.capacity,
      plannedDives: priced.plannedDives,
      priceCents: 20_000,
    });
    expect((await getTripWithBooked(db, shop.id, priced.id))?.priceCents).toBe(20_000);

    await updateTrip(db, shop.id, priced.id, {
      title: priced.title,
      startsAt: priced.startsAt,
      endsAt: priced.endsAt,
      capacity: priced.capacity,
      plannedDives: priced.plannedDives,
      priceCents: null,
    });
    expect((await getTripWithBooked(db, shop.id, priced.id))?.priceCents).toBeNull();
  });

  it("stores up to four ordered dives while allowing blank dive details", async () => {
    const { db, shop } = await seededShopContext();
    const existing = (await upcomingTripsWithCounts(db, shop.id)).find((trip) => trip.diveSiteId);
    if (!existing) throw new Error("seeded dive site missing");

    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Four-dive weekend",
      startsAt: new Date("2030-08-03T13:00:00.000Z"),
      endsAt: new Date("2030-08-03T21:00:00.000Z"),
      capacity: 10,
      plannedDives: 4,
      dives: [
        { title: "Morning reef", diveSiteId: existing.diveSiteId },
        { title: "Second tank", description: "A relaxed second site." },
        {},
        { title: "Sunset drift" },
      ],
    });
    if (!trip) throw new Error("trip not created");

    const dives = await listTripDives(db, shop.id, trip.id);
    expect(dives).toHaveLength(4);
    expect(dives.map(({ dive }) => dive.diveNumber)).toEqual([1, 2, 3, 4]);
    expect(dives[0]?.dive.title).toBe("Morning reef");
    expect(dives[0]?.diveSite?.id).toBe(existing.diveSiteId);
    expect(dives[1]?.dive.description).toBe("A relaxed second site.");
    expect(dives[2]?.dive.title).toBeNull();
    expect(
      await createTrip(db, {
        shopId: shop.id,
        title: "Too many dives",
        startsAt: new Date("2030-08-04T13:00:00.000Z"),
        endsAt: new Date("2030-08-04T21:00:00.000Z"),
        capacity: 10,
        plannedDives: 5,
      }),
    ).toBeNull();
  });

  it("materializes a weekly series of identical, independent trips", async () => {
    const { db, shop } = await seededShopContext();

    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday Two-Tank",
      description: "Weekly reef charter.",
      capacity: 12,
      plannedDives: 2,
      priceCents: 15_000,
      frequency: "weekly",
      intervalWeeks: 1,
      occurrences: [
        {
          startsAt: new Date("2030-09-07T11:00:00.000Z"),
          endsAt: new Date("2030-09-07T15:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-09-14T11:00:00.000Z"),
          endsAt: new Date("2030-09-14T15:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-09-21T11:00:00.000Z"),
          endsAt: new Date("2030-09-21T15:00:00.000Z"),
        },
      ],
    });
    if (!result) throw new Error("series not created");
    expect(result.series.occurrenceCount).toBe(3);
    expect(result.trips).toHaveLength(3);
    const [firstInstance] = result.trips;
    if (!firstInstance) throw new Error("expected a first instance");

    // Every instance points back to the one series and starts identical.
    for (const trip of result.trips) {
      expect(trip.seriesId).toBe(result.series.id);
      expect(trip.title).toBe("Saturday Two-Tank");
      expect(trip.capacity).toBe(12);
      expect(trip.priceCents).toBe(15_000);
      // A readiness requirement row is materialized for each — never an accidental pass.
      const reqs = await db
        .select()
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, trip.id));
      expect(reqs).toHaveLength(1);
    }

    // Provenance query reports the cadence and how many are still scheduled.
    const summary = await getTripSeriesSummary(db, shop.id, firstInstance.id);
    expect(summary?.intervalWeeks).toBe(1);
    expect(summary?.scheduledCount).toBe(3);
  });

  it("edits and cancels one instance without touching its siblings", async () => {
    const { db, shop } = await seededShopContext();

    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Weeknight Shore Dive",
      capacity: 8,
      plannedDives: 1,
      frequency: "weekly",
      intervalWeeks: 1,
      occurrences: [
        {
          startsAt: new Date("2030-10-01T22:00:00.000Z"),
          endsAt: new Date("2030-10-02T00:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-10-08T22:00:00.000Z"),
          endsAt: new Date("2030-10-09T00:00:00.000Z"),
        },
      ],
    });
    if (!result) throw new Error("series not created");
    const [first, second] = result.trips;
    if (!first || !second) throw new Error("expected two instances");

    await updateTrip(db, shop.id, first.id, {
      title: "Weeknight Shore Dive — Full Moon",
      startsAt: first.startsAt,
      endsAt: first.endsAt,
      capacity: 20,
      plannedDives: first.plannedDives,
    });
    await setTripStatus(db, shop.id, first.id, "cancelled");

    const editedFirst = await getTripWithBooked(db, shop.id, first.id);
    const untouchedSecond = await getTripWithBooked(db, shop.id, second.id);
    expect(editedFirst?.title).toBe("Weeknight Shore Dive — Full Moon");
    expect(editedFirst?.capacity).toBe(20);
    expect(untouchedSecond?.title).toBe("Weeknight Shore Dive");
    expect(untouchedSecond?.capacity).toBe(8);

    // Cancelling one instance shrinks the still-scheduled count, not the series record.
    const summary = await getTripSeriesSummary(db, shop.id, second.id);
    expect(summary?.occurrenceCount).toBe(2);
    expect(summary?.scheduledCount).toBe(1);
  });

  it("rejects a series with an invalid dive count", async () => {
    const { db, shop } = await seededShopContext();
    expect(
      await createTripSeries(db, {
        shopId: shop.id,
        title: "Impossible cadence",
        capacity: 10,
        plannedDives: 9,
        frequency: "weekly",
        intervalWeeks: 1,
        occurrences: [
          {
            startsAt: new Date("2030-11-01T13:00:00.000Z"),
            endsAt: new Date("2030-11-01T17:00:00.000Z"),
          },
        ],
      }),
    ).toBeNull();
  });
});
