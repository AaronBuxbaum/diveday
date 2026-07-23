// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { bookings, people, rollCallEvents, tripRequirements } from "./schema";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  createTrip,
  createTripSeries,
  extendTripSeries,
  getLatestSeriesInstance,
  getTripCrewIds,
  getTripRoster,
  getTripSeriesById,
  getTripSeriesSummary,
  getTripWithBooked,
  listStaff,
  listTripDives,
  pagedUpcomingTripsWithCounts,
  setTripCrew,
  setTripStatus,
  upcomingScheduleRange,
  upcomingScheduleStats,
  upcomingTripsWithCounts,
  updateTrip,
} from "./trips";

const FOREIGN_SHOP_ID = "00000000-0000-4000-8000-000000000099";

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

    const [entry] = await getTripRoster(db, reef.id);
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
});
