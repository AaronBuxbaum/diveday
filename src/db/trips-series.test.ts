import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, people, rollCallEvents, tripRequirements } from "./schema";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  createTripSeries,
  extendTripSeries,
  getLatestSeriesInstance,
  getTripSeriesById,
  getTripSeriesSummary,
  getTripWithBooked,
  listStaff,
  setTripStatus,
  updateTrip,
} from "./trips";

describe("recurring trip series (in-memory PGlite)", () => {
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
