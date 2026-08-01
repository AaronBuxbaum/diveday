// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { bookings, people, rollCallEvents, shops, tripRequirements } from "./schema";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  changeTripCrew,
  createTrip,
  createTripSeries,
  duplicateTrip,
  extendTripSeries,
  getLatestSeriesInstance,
  getTripCrewIds,
  getTripRoster,
  getTripSeriesById,
  getTripSeriesSummary,
  getTripWithBooked,
  listStaff,
  listTripDives,
  listTripScheduleDays,
  moveTrip,
  pagedUpcomingTripsWithCounts,
  setTripCrew,
  setTripStatus,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingStaffSchedule,
  upcomingTripsWithCounts,
  updateTrip,
} from "./trips";

const FOREIGN_SHOP_ID = "00000000-0000-4000-8000-000000000099";

describe("demo seed + schedule queries (in-memory PGlite)", () => {
  it("stores variable meeting windows and rejects crew overlap on any course day", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    if (!instructor) throw new Error("seeded instructor missing");
    const first = await createTrip(db, {
      shopId: shop.id,
      title: "Open Water test class",
      startsAt: new Date("2030-08-01T12:00:00Z"),
      endsAt: new Date("2030-08-02T18:00:00Z"),
      capacity: 4,
      scheduleDays: [
        {
          dayNumber: 1,
          startsAt: new Date("2030-08-01T12:00:00Z"),
          endsAt: new Date("2030-08-01T16:00:00Z"),
        },
        {
          dayNumber: 2,
          startsAt: new Date("2030-08-02T12:00:00Z"),
          endsAt: new Date("2030-08-02T18:00:00Z"),
        },
      ],
    });
    if (!first) throw new Error("first multi-day trip not created");
    expect(await listTripScheduleDays(db, shop.id, first.id)).toHaveLength(2);
    expect(await setTripCrew(db, shop.id, first.id, [instructor.person.id])).toBe(true);
    const board = await upcomingStaffSchedule(
      db,
      shop.id,
      new Date("2030-08-01T00:00:00Z"),
      new Date("2030-09-01T00:00:00Z"),
      new Date("2030-07-01T00:00:00Z"),
    );
    expect(board.find((trip) => trip.id === first.id)).toMatchObject({
      days: [
        { dayNumber: 1, startsAt: new Date("2030-08-01T12:00:00Z") },
        { dayNumber: 2, startsAt: new Date("2030-08-02T12:00:00Z") },
      ],
      crew: [{ id: instructor.person.id, name: instructor.person.fullName }],
    });
    const second = await createTrip(db, {
      shopId: shop.id,
      title: "Day-two overlap",
      startsAt: new Date("2030-08-02T15:00:00Z"),
      endsAt: new Date("2030-08-02T17:00:00Z"),
      capacity: 4,
    });
    if (!second) throw new Error("second trip not created");
    expect(await setTripCrew(db, shop.id, second.id, [instructor.person.id])).toBe(false);
  });

  it("returns upcoming trips ordered by start with correct booked counts", async () => {
    const { db, shop } = await seededShopContext();

    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    expect(upcoming).toHaveLength(42);

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

  it("refuses to shrink capacity below the trip's active booking count", async () => {
    const { db, shop } = await seededShopContext();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    // 9 of 12 booked in the seed.
    const reef = upcoming.find((t) => t.title === "Two-Tank Reef — Molasses & French");
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(reef.booked).toBe(9);

    const refused = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: 8,
      plannedDives: reef.plannedDives,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "capacity_below_booked",
      detail: { bookedCount: 9 },
    });
    // Untouched — the capacity in the database still reads the original value.
    expect((await getTripWithBooked(db, shop.id, reef.id))?.capacity).toBe(reef.capacity);

    const accepted = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: 9,
      plannedDives: reef.plannedDives,
    });
    expect(accepted.ok).toBe(true);
    expect((await getTripWithBooked(db, shop.id, reef.id))?.capacity).toBe(9);
  });

  it("refuses to drop planned dives below a checkpoint staff already recorded a roll call against", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const reef = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
    if (!reef) throw new Error("expected seeded reef trip missing");
    expect(reef.plannedDives).toBeGreaterThanOrEqual(2);

    const [entry] = await getTripRoster(db, shop.id, reef.id);
    if (!entry) throw new Error("expected a booking to record a roll call against");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("expected seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: reef.id,
      bookingId: entry.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "after_dive_2",
      occurredAt: nowDate(),
    });

    const refused = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: 1,
    });
    expect(refused).toEqual({
      ok: false,
      reason: "planned_dives_below_history",
      detail: { recordedDiveCount: 2 },
    });
    expect((await getTripWithBooked(db, shop.id, reef.id))?.plannedDives).toBe(reef.plannedDives);

    // Equal to the recorded history is fine; only going below it is refused.
    const accepted = await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: 2,
    });
    expect(accepted.ok).toBe(true);
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

  it("applies one date's details across the future series, skipping over-booked dates", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Sunday Reef",
      capacity: 12,
      plannedDives: 2,
      priceCents: 15_000,
      frequency: "weekly",
      intervalWeeks: 1,
      occurrences: [
        {
          startsAt: new Date("2030-09-01T11:00:00.000Z"),
          endsAt: new Date("2030-09-01T15:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-09-08T11:00:00.000Z"),
          endsAt: new Date("2030-09-08T15:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-09-15T11:00:00.000Z"),
          endsAt: new Date("2030-09-15T15:00:00.000Z"),
        },
      ],
    });
    if (!result) throw new Error("series not created");
    const [source, crowded, untouched] = result.trips;
    if (!source || !crowded || !untouched) throw new Error("expected three instances");

    // Two real bookings land on the middle date so a shrink below its head-count is refused.
    const [p1, p2] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(2);
    if (!p1 || !p2) throw new Error("seed people missing");
    await db.insert(bookings).values([
      { shopId: shop.id, tripId: crowded.id, personId: p1.id },
      { shopId: shop.id, tripId: crowded.id, personId: p2.id },
    ]);

    // Staff retune the first date, then push it across the run — with a capacity
    // below the crowded date's head-count so it must be skipped.
    await updateTrip(db, shop.id, source.id, {
      title: "Sunday Reef — Deep Edition",
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      capacity: 1,
      plannedDives: source.plannedDives,
      priceCents: 22_000,
    });

    const applied = await applyDetailsToFutureSeries(db, shop.id, result.series.id, source.id, now);
    expect(applied).toEqual({ updated: 1, skipped: 1 });

    const changed = await getTripWithBooked(db, shop.id, untouched.id);
    expect(changed?.title).toBe("Sunday Reef — Deep Edition");
    expect(changed?.capacity).toBe(1);
    expect(changed?.priceCents).toBe(22_000);
    // Its own date is untouched — only the template travels, never the schedule.
    expect(changed?.startsAt.toISOString()).toBe("2030-09-15T11:00:00.000Z");

    const skipped = await getTripWithBooked(db, shop.id, crowded.id);
    expect(skipped?.title).toBe("Sunday Reef");
    expect(skipped?.capacity).toBe(12);
  });

  it("skips a sibling whose recorded roll call would be orphaned by the new dive count", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Monday Wreck",
      capacity: 10,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      occurrences: [
        {
          startsAt: new Date("2030-09-02T11:00:00.000Z"),
          endsAt: new Date("2030-09-02T15:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-09-09T11:00:00.000Z"),
          endsAt: new Date("2030-09-09T15:00:00.000Z"),
        },
      ],
    });
    if (!result) throw new Error("series not created");
    const [source, sailed] = result.trips;
    if (!source || !sailed) throw new Error("expected two instances");

    // The second date already sailed its second dive — staff logged a roll
    // call after it.
    const [p1] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    const [staff] = await listStaff(db, shop.id);
    if (!p1 || !staff) throw new Error("seed people/staff missing");
    const [booked] = await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: sailed.id, personId: p1.id })
      .returning();
    if (!booked) throw new Error("booking insert failed");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: sailed.id,
      bookingId: booked.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "after_dive_2",
      occurredAt: now,
    });

    // Staff shrink the template to a single dive and push it across the run.
    await updateTrip(db, shop.id, source.id, {
      title: source.title,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      capacity: source.capacity,
      plannedDives: 1,
    });

    const applied = await applyDetailsToFutureSeries(db, shop.id, result.series.id, source.id, now);
    expect(applied).toEqual({ updated: 0, skipped: 1 });

    const untouched = await getTripWithBooked(db, shop.id, sailed.id);
    expect(untouched?.plannedDives).toBe(2);
  });

  it("cancels every upcoming date at once but leaves past dates alone", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Friday Night Dive",
      capacity: 8,
      plannedDives: 1,
      frequency: "weekly",
      intervalWeeks: 1,
      occurrences: [
        {
          startsAt: new Date("2030-08-01T22:00:00.000Z"),
          endsAt: new Date("2030-08-02T00:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-08-22T22:00:00.000Z"),
          endsAt: new Date("2030-08-23T00:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-08-29T22:00:00.000Z"),
          endsAt: new Date("2030-08-30T00:00:00.000Z"),
        },
      ],
    });
    if (!result) throw new Error("series not created");
    const [past, upcoming] = result.trips;
    if (!past || !upcoming) throw new Error("expected instances");

    const cancelled = await cancelFutureSeriesTrips(db, shop.id, result.series.id, now);
    expect(cancelled).toBe(2);

    expect((await getTripWithBooked(db, shop.id, past.id))?.status).toBe("scheduled");
    const summary = await getTripSeriesSummary(db, shop.id, upcoming.id, now);
    expect(summary?.futureScheduledCount).toBe(0);
    // The series record and its total are untouched — only the instances flipped.
    expect(summary?.occurrenceCount).toBe(3);
  });

  it("rolls the horizon forward, inheriting the latest date's template", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday Wall",
      capacity: 10,
      plannedDives: 2,
      priceCents: 16_000,
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
      ],
    });
    if (!result) throw new Error("series not created");

    const latestBefore = await getLatestSeriesInstance(db, shop.id, result.series.id);
    expect(latestBefore?.startsAt.toISOString()).toBe("2030-09-14T11:00:00.000Z");

    const extended = await extendTripSeries(db, {
      shopId: shop.id,
      seriesId: result.series.id,
      occurrences: [
        {
          startsAt: new Date("2030-09-21T11:00:00.000Z"),
          endsAt: new Date("2030-09-21T15:00:00.000Z"),
        },
        {
          startsAt: new Date("2030-09-28T11:00:00.000Z"),
          endsAt: new Date("2030-09-28T15:00:00.000Z"),
        },
      ],
    });
    if (!extended) throw new Error("series not extended");
    expect(extended.trips).toHaveLength(2);
    expect(extended.series.occurrenceCount).toBe(4);
    for (const trip of extended.trips) {
      expect(trip.seriesId).toBe(result.series.id);
      expect(trip.title).toBe("Saturday Wall");
      expect(trip.capacity).toBe(10);
      expect(trip.priceCents).toBe(16_000);
    }
    const latestAfter = await getLatestSeriesInstance(db, shop.id, result.series.id);
    expect(latestAfter?.startsAt.toISOString()).toBe("2030-09-28T11:00:00.000Z");
    expect((await getTripSeriesById(db, shop.id, result.series.id))?.occurrenceCount).toBe(4);
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

describe("paged schedule queries", () => {
  it("pages the board with a keyset cursor, in departure order, without gaps", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let hops = 0; hops < 20; hops++) {
      const page = await pagedUpcomingTripsWithCounts(db, shop.id, { cursor, limit: 5 });
      expect(page.trips.length).toBeLessThanOrEqual(5);
      seen.push(...page.trips.map((t) => t.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.map((t) => t.id));

    const onePage = await pagedUpcomingTripsWithCounts(db, shop.id);
    expect(onePage.nextCursor).toBeNull(); // seed fits one default page
    expect(onePage.trips.map((t) => t.id)).toEqual(all.map((t) => t.id));
  });

  it("filters to fun dives or course sessions on request", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    expect(all.some((t) => t.course !== null)).toBe(true);
    expect(all.some((t) => t.course === null)).toBe(true);

    const funDives = await pagedUpcomingTripsWithCounts(db, shop.id, { tripType: "fun_dive" });
    expect(funDives.trips.length).toBeGreaterThan(0);
    expect(funDives.trips.every((t) => t.course === null)).toBe(true);

    const courseSessions = await pagedUpcomingTripsWithCounts(db, shop.id, { tripType: "course" });
    expect(courseSessions.trips.length).toBeGreaterThan(0);
    expect(courseSessions.trips.every((t) => t.course !== null)).toBe(true);

    expect(funDives.trips.length + courseSessions.trips.length).toBe(all.length);
  });

  it("filters to trips with an open seat on request", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    expect(all.some((t) => t.booked >= t.capacity)).toBe(true); // the seed has a full trip
    expect(all.some((t) => t.booked < t.capacity)).toBe(true);

    const withSpace = await pagedUpcomingTripsWithCounts(db, shop.id, {
      hasSpace: true,
      limit: 200,
    });
    expect(withSpace.trips.length).toBeGreaterThan(0);
    expect(withSpace.trips.length).toBeLessThan(all.length);
    expect(withSpace.trips.every((t) => t.booked < t.capacity)).toBe(true);
  });

  it("computes board-wide stats that match the full list", async () => {
    const { db, shop } = await seededShopContext();
    const all = await upcomingTripsWithCounts(db, shop.id);
    const stats = await upcomingScheduleStats(db, shop.id);

    expect(stats.departures).toBe(all.length);
    expect(stats.booked).toBe(all.reduce((sum, t) => sum + t.booked, 0));
    expect(stats.openSeats).toBe(
      all.reduce((sum, t) => sum + Math.max(0, t.capacity - t.booked), 0),
    );
    expect(stats.atCapacity).toBe(all.filter((t) => t.booked >= t.capacity).length);

    const range = await upcomingScheduleRange(db, shop.id);
    expect(range.first?.getTime()).toBe(all[0]?.startsAt.getTime());
    expect(range.last?.getTime()).toBe(all.at(-1)?.startsAt.getTime());
  });

  it("bounds the page to an explicit month, so the list can follow the calendar", async () => {
    const { db, shop } = await seededShopContext();
    const now = new Date("2030-07-01T00:00:00.000Z");

    const august = await createTrip(db, {
      shopId: shop.id,
      title: "August trip",
      startsAt: new Date("2030-08-15T12:00:00Z"),
      endsAt: new Date("2030-08-15T16:00:00Z"),
      capacity: 4,
    });
    const september = await createTrip(db, {
      shopId: shop.id,
      title: "September trip",
      startsAt: new Date("2030-09-15T12:00:00Z"),
      endsAt: new Date("2030-09-15T16:00:00Z"),
      capacity: 4,
    });
    if (!august || !september) throw new Error("trip not created");

    const augustPage = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now,
      monthStart: new Date("2030-08-01T00:00:00Z"),
      monthEnd: new Date("2030-09-01T00:00:00Z"),
    });
    expect(augustPage.trips.map((t) => t.id)).toEqual([august.id]);
    expect(augustPage.nextCursor).toBeNull();

    const septemberPage = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now,
      monthStart: new Date("2030-09-01T00:00:00Z"),
      monthEnd: new Date("2030-10-01T00:00:00Z"),
    });
    expect(septemberPage.trips.map((t) => t.id)).toEqual([september.id]);

    // A month bound that starts before `now` still respects `now` as the floor.
    const augustFromLaterNow = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now: new Date("2030-08-16T00:00:00Z"),
      monthStart: new Date("2030-08-01T00:00:00Z"),
      monthEnd: new Date("2030-09-01T00:00:00Z"),
    });
    expect(augustFromLaterNow.trips).toHaveLength(0);
  });
});

describe("trip crew (CR-007: cross-tenant write path)", () => {
  it("assigns and replaces the crew, keeping only staff of this shop", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    const staff = await listStaff(db, shop.id);
    if (staff.length < 2) throw new Error("expected at least two seeded staff");

    const [first, second] = staff;
    if (!first || !second) throw new Error("expected two staff rows");
    expect(
      await setTripCrew(db, shop.id, trip.id, [
        first.person.id,
        second.person.id,
        crypto.randomUUID(), // not a real person — silently dropped, not an error
      ]),
    ).toBe(true);
    expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(
      new Set([first.person.id, second.person.id]),
    );

    // Replacing with a smaller set actually removes the dropped assignment.
    expect(await setTripCrew(db, shop.id, trip.id, [first.person.id])).toBe(true);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([first.person.id]);
  });
  it("changes one crew member without replacing other assignments", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    const staff = await listStaff(db, shop.id);
    const [first, second] = staff;
    if (!first || !second) throw new Error("expected two seeded staff");

    expect(await setTripCrew(db, shop.id, trip.id, [first.person.id])).toBe(true);
    expect(
      await changeTripCrew(db, shop.id, trip.id, {
        personId: second.person.id,
        operation: "assign",
      }),
    ).toBe(true);
    expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(
      new Set([first.person.id, second.person.id]),
    );

    expect(
      await changeTripCrew(db, shop.id, trip.id, {
        personId: first.person.id,
        operation: "unassign",
      }),
    ).toBe(true);
    expect(await getTripCrewIds(db, shop.id, trip.id)).toEqual([second.person.id]);
  });

  it("refuses to write or read crew for a trip id that isn't this shop's", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips[0];
    if (!trip) throw new Error("expected a seeded trip");
    const [staffMember, otherStaffMember] = await listStaff(db, shop.id);
    if (!staffMember || !otherStaffMember) throw new Error("expected two seeded staff");
    // Some seeded trips already carry crew (e.g. an instructor); capture
    // whatever this trip starts with so the refusal can be proven by
    // "unchanged", not by assuming an empty starting state.
    const before = new Set(await getTripCrewIds(db, shop.id, trip.id));

    // A tripId that is real, but for a different shop, must not let that
    // shop's staff list get written onto it.
    expect(await setTripCrew(db, FOREIGN_SHOP_ID, trip.id, [otherStaffMember.person.id])).toBe(
      false,
    );
    expect(new Set(await getTripCrewIds(db, shop.id, trip.id))).toEqual(before);

    // Nor does asking for the crew under the wrong shop leak the real one.
    await setTripCrew(db, shop.id, trip.id, [staffMember.person.id]);
    expect(await getTripCrewIds(db, FOREIGN_SHOP_ID, trip.id)).toEqual([]);
  });

  it("does not leak a trip's roster to a genuinely different shop (CR-007)", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-roster-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find((t) => t.booked > 0);
    if (!trip) throw new Error("expected a seeded trip with at least one booking");

    const roster = await getTripRoster(db, shop.id, trip.id);
    expect(roster.length).toBeGreaterThan(0);

    // A real second shop, asking about shop's real, booked trip — not a
    // hardcoded placeholder id — sees nothing.
    expect(await getTripRoster(db, otherShop.id, trip.id)).toEqual([]);
  });
});

describe("moveTrip / duplicateTrip across a DST transition", () => {
  // The seeded blue-mantis shop is America/New_York. Spring-forward in 2026
  // is Sunday March 8 (2am -> 3am). This 3-day course's own days straddle the
  // transition: day 1 (Mar 6) and day 2 (Mar 7) fall before it, EST (UTC-4);
  // day 3 (Mar 8, 07:30 — after the 2am jump) falls after it, EDT (UTC-4).
  // Moved to Mar 13-15 (all EDT, no further transition in between), a naive
  // fixed-millisecond delta computed from the *start's* own EST->EDT crossing
  // over-corrects day 3 (which needed no crossing at all, having already been
  // EDT) and the trip's endsAt by an extra hour. Preserving wall-clock time
  // per calendar day, independent of which offset each day happened to start
  // in, is what this guards.
  const tz = "America/New_York";
  const wall = (day: number, hour: number, minute = 30) =>
    wallTimeToUtc({ year: 2026, month: 3, day, hour, minute }, tz);

  function buildThreeDayCourse(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
  ) {
    return createTrip(db, {
      shopId,
      title: "DST regression — three-day course",
      startsAt: wall(6, 7),
      endsAt: wall(8, 16, 0),
      capacity: 4,
      scheduleDays: [
        { dayNumber: 1, startsAt: wall(6, 7), endsAt: wall(6, 16, 0) },
        { dayNumber: 2, startsAt: wall(7, 7), endsAt: wall(7, 16, 0) },
        { dayNumber: 3, startsAt: wall(8, 7), endsAt: wall(8, 16, 0) },
      ],
    });
  }

  it("moveTrip preserves each schedule day's wall-clock hour across spring-forward", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await buildThreeDayCourse(db, shop.id);
    if (!source) throw new Error("source trip not created");

    const outcome = await moveTrip(db, shop.id, source.id, wall(13, 7));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(utcToWallTime(outcome.trip.startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(outcome.trip.endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });

    const days = await listTripScheduleDays(db, shop.id, source.id);
    expect(days).toHaveLength(3);
    const byDay = Object.fromEntries(days.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(byDay[1].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[2].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });
  });

  it("duplicateTrip preserves each schedule day's wall-clock hour across spring-forward", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await buildThreeDayCourse(db, shop.id);
    if (!source) throw new Error("source trip not created");

    const copy = await duplicateTrip(db, shop.id, source.id, wall(13, 7));
    if (!copy) throw new Error("duplicate not created");

    expect(utcToWallTime(copy.startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(copy.endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });

    const days = await listTripScheduleDays(db, shop.id, copy.id);
    expect(days).toHaveLength(3);
    const byDay = Object.fromEntries(days.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(byDay[1].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[2].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
      minute: 30,
    });
    expect(utcToWallTime(byDay[3].endsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 15,
      hour: 16,
      minute: 0,
    });
    // The source trip's own days must be untouched by the duplicate.
    const sourceDays = await listTripScheduleDays(db, shop.id, source.id);
    const sourceByDay = Object.fromEntries(sourceDays.map((d) => [d.dayNumber, d]));
    expect(utcToWallTime(sourceByDay[3].startsAt, tz)).toEqual({
      year: 2026,
      month: 3,
      day: 8,
      hour: 7,
      minute: 30,
    });
  });
});

describe("moveTrip / duplicateTrip when the start's clock time also changes", () => {
  // A move isn't always "same time, new day" — the schedule builder lets
  // staff pick a new date *and* a new departure time in one step. endsAt (and
  // any other schedule day) must carry that time-of-day change too, or the
  // trip's duration silently changes: a departure created 09:00-13:00 (4h)
  // and moved to 07:15 must land at 07:15-11:15, not stay stuck at 13:00.
  const tz = "America/New_York";
  const wall = (day: number, hour: number, minute = 0) =>
    wallTimeToUtc({ year: 2026, month: 6, day, hour, minute }, tz);

  it("moveTrip shifts endsAt by the same wall-clock delta as the new start time", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Time-change regression",
      startsAt: wall(10, 9, 0),
      endsAt: wall(10, 13, 0),
      capacity: 4,
    });
    if (!source) throw new Error("source trip not created");

    const outcome = await moveTrip(db, shop.id, source.id, wall(12, 7, 15));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(utcToWallTime(outcome.trip.startsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 7,
      minute: 15,
    });
    expect(utcToWallTime(outcome.trip.endsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });

  it("duplicateTrip shifts endsAt by the same wall-clock delta as the new start time", async () => {
    const { db, shop } = await seededShopContext();
    expect(shop.timezone).toBe(tz);

    const source = await createTrip(db, {
      shopId: shop.id,
      title: "Time-change regression",
      startsAt: wall(10, 9, 0),
      endsAt: wall(10, 13, 0),
      capacity: 4,
    });
    if (!source) throw new Error("source trip not created");

    const copy = await duplicateTrip(db, shop.id, source.id, wall(12, 7, 15));
    if (!copy) throw new Error("duplicate not created");

    expect(utcToWallTime(copy.startsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 7,
      minute: 15,
    });
    expect(utcToWallTime(copy.endsAt, tz)).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });
});
