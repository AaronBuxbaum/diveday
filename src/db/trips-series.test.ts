import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateWeekday } from "@/lib/calendar-date";
import { EVERY_WEEKDAY, weekdaySetFrom } from "@/lib/recurrence";
import { seededShopContext } from "@/test/db";
import { bookings, people, rollCallEvents, tripRequirements, tripSeries, trips } from "./schema";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  cancelOffCadenceSeriesTrips,
  createTripSeries,
  deleteTrip,
  getLatestSeriesInstance,
  getTripSeriesById,
  getTripSeriesSummary,
  getTripWithBooked,
  listOffCadenceSeriesTrips,
  listStaff,
  listTripScheduleDays,
  moveTrip,
  type NewTripSeries,
  rollAllSeriesForward,
  rollSeriesForward,
  setSeriesRepeat,
  setTripStatus,
  updateSeriesCadence,
  updateTrip,
} from "./trips";

/**
 * Every fixture is anchored in the shop's own zone (the seed's
 * `America/New_York`) with an explicit `endsOn`, so a test asserting an exact
 * set of dates is asserting the cadence rather than today's date plus the
 * horizon. The open-ended cases — which are the point of the feature — assert
 * on counts and on what a roll does, never on a fixed list.
 */
const TZ = "America/New_York";
const SUN = 0;
const MON = 1;
const WED = 3;
const THU = 4;
const SAT = 6;

/** 11:00Z is 07:00 in the shop's summer zone — a real morning departure. */
const at = (iso: string) => new Date(iso);

function seriesInput(overrides: Partial<NewTripSeries> & { shopId: string }): NewTripSeries {
  return {
    title: "Saturday Two-Tank",
    capacity: 12,
    plannedDives: 2,
    frequency: "weekly",
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([SAT]),
    anchorDate: "2030-09-07",
    endsOn: null,
    timeZone: TZ,
    template: {
      startsAt: at("2030-09-07T11:00:00.000Z"),
      endsAt: at("2030-09-07T15:00:00.000Z"),
    },
    ...overrides,
  };
}

/** The shop-local dates a series has on the board, in order. */
async function occurrenceDatesOf(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  seriesId: string,
) {
  // Live rows only: this asks what is *on the board* for the series, and a
  // deleted departure keeps its row and its occurrence date (ADR
  // 20260820-every-delete-is-soft). Reading the tombstone here would make the
  // deleted-date test pass for the wrong reason — and, worse, hide the roll
  // inserting a fresh live row for the same date, which is the thing it guards.
  const rows = await db
    .select({ date: trips.seriesOccurrenceDate })
    .from(trips)
    .where(and(eq(trips.seriesId, seriesId), isNull(trips.deletedAt)));
  return rows
    .map((row) => row.date)
    .filter((date): date is string => date !== null)
    .sort();
}

describe("recurring trip series (in-memory PGlite)", () => {
  it("materializes a weekly run of identical, independent trips", async () => {
    const { db, shop } = await seededShopContext();

    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        description: "Weekly reef charter.",
        priceCents: 15_000,
        endsOn: "2030-09-21",
      }),
    );
    if (!result) throw new Error("series not created");
    expect(result.trips).toHaveLength(3);
    expect(result.series.weekdayMask).toBe(weekdaySetFrom([SAT]));
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual([
      "2030-09-07",
      "2030-09-14",
      "2030-09-21",
    ]);

    const [firstInstance] = result.trips;
    if (!firstInstance) throw new Error("expected a first instance");

    for (const trip of result.trips) {
      expect(trip.seriesId).toBe(result.series.id);
      expect(trip.title).toBe("Saturday Two-Tank");
      expect(trip.capacity).toBe(12);
      expect(trip.priceCents).toBe(15_000);
      // Every instance departs at the same shop-local hour — 07:00 in New York.
      expect(trip.startsAt.toISOString().slice(11, 16)).toBe("11:00");
      // A readiness requirement row is materialized for each — never an accidental pass.
      const reqs = await db
        .select()
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, trip.id));
      expect(reqs).toHaveLength(1);
    }

    const summary = await getTripSeriesSummary(db, shop.id, firstInstance.id);
    expect(summary?.intervalWeeks).toBe(1);
    expect(summary?.scheduledCount).toBe(3);
    expect(summary?.endsOn).toBe("2030-09-21");
  });

  it("materializes a private charter series, keeping all occurrences private", async () => {
    const { db, shop } = await seededShopContext();

    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        isPrivate: true,
        endsOn: "2030-09-21",
      }),
    );
    if (!result) throw new Error("series not created");
    expect(result.trips).toHaveLength(3);
    for (const trip of result.trips) {
      expect(trip.isPrivate).toBe(true);
    }
  });

  it("puts a run on more than one weekday a week — Monday and Thursday is one series", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Mon & Thu shore dive",
        anchorDate: "2030-09-02", // a Monday
        weekdays: weekdaySetFrom([MON, THU]),
        endsOn: "2030-09-12",
        template: {
          startsAt: at("2030-09-02T22:00:00.000Z"),
          endsAt: at("2030-09-03T00:00:00.000Z"),
        },
      }),
    );
    if (!result) throw new Error("series not created");
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual([
      "2030-09-02",
      "2030-09-05",
      "2030-09-09",
      "2030-09-12",
    ]);
  });

  it("runs daily when every weekday is selected", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Daily morning two-tank",
        weekdays: EVERY_WEEKDAY,
        endsOn: "2030-09-13",
      }),
    );
    if (!result) throw new Error("series not created");
    expect(result.trips).toHaveLength(7);
  });

  it("has no limit: an open-ended run fills the horizon and keeps going", async () => {
    const { db, shop } = await seededShopContext();
    // The old model capped a series at 26 dates. A daily run across the
    // horizon is already four times that, and it does not stop there.
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: EVERY_WEEKDAY, endsOn: null }),
    );
    if (!result) throw new Error("series not created");
    expect(result.trips.length).toBeGreaterThan(100);

    // Rolling from a date inside the run adds the dates that have come into
    // range and nothing else.
    const latestBefore = await getLatestSeriesInstance(db, shop.id, result.series.id);
    const rolled = await rollSeriesForward(
      db,
      shop.id,
      result.series.id,
      at("2030-10-07T12:00:00.000Z"),
    );
    expect(rolled?.created).toBe(30);
    const latestAfter = await getLatestSeriesInstance(db, shop.id, result.series.id);
    expect(latestAfter?.startsAt.getTime()).toBeGreaterThan(latestBefore?.startsAt.getTime() ?? 0);
  });

  it("rolling twice over the same window changes nothing the second time", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    const now = at("2030-10-07T12:00:00.000Z");
    const first = await rollSeriesForward(db, shop.id, result.series.id, now);
    const second = await rollSeriesForward(db, shop.id, result.series.id, now);
    expect(first?.created).toBeGreaterThan(0);
    expect(second?.created).toBe(0);
  });

  it("never puts a deleted date back on the board", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    const [, second] = result.trips;
    if (!second) throw new Error("expected a second instance");
    const removedDate = second.seriesOccurrenceDate;

    expect(await deleteTrip(db, shop.id, second.id)).toEqual({ ok: true });
    expect(await occurrenceDatesOf(db, result.series.id)).not.toContain(removedDate);

    // The roll re-proposes every cadence date in its window, including this
    // one — the skip ledger is the only thing keeping it off the board.
    await rollSeriesForward(db, shop.id, result.series.id, at("2030-09-07T12:00:00.000Z"));
    expect(await occurrenceDatesOf(db, result.series.id)).not.toContain(removedDate);
  });

  it("never re-creates a date staff moved somewhere else", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    const [, second] = result.trips;
    if (!second) throw new Error("expected a second instance");

    // Slide the second Saturday to the Sunday after it. Its cadence slot moves
    // with it, so the roll must not read that Saturday as an empty slot.
    const moved = await moveTrip(db, shop.id, second.id, at("2030-09-15T11:00:00.000Z"));
    expect(moved.ok).toBe(true);
    const before = await occurrenceDatesOf(db, result.series.id);
    await rollSeriesForward(db, shop.id, result.series.id, at("2030-09-07T12:00:00.000Z"));
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual(before);
  });

  it("edits and cancels one instance without touching its siblings", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Weeknight Shore Dive",
        capacity: 8,
        plannedDives: 1,
        endsOn: "2030-09-14",
      }),
    );
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

    const summary = await getTripSeriesSummary(db, shop.id, second.id);
    expect(summary?.scheduledCount).toBe(1);
  });

  it("applies one date's details across the future series, skipping over-booked dates", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Sunday Reef",
        priceCents: 15_000,
        anchorDate: "2030-09-01", // a Sunday
        weekdays: weekdaySetFrom([SUN]),
        endsOn: "2030-09-15",
        template: {
          startsAt: at("2030-09-01T11:00:00.000Z"),
          endsAt: at("2030-09-01T15:00:00.000Z"),
        },
      }),
    );
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
    const now = at("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Monday Wreck",
        capacity: 10,
        anchorDate: "2030-09-02",
        weekdays: weekdaySetFrom([MON]),
        endsOn: "2030-09-09",
        template: {
          startsAt: at("2030-09-02T11:00:00.000Z"),
          endsAt: at("2030-09-02T15:00:00.000Z"),
        },
      }),
    );
    if (!result) throw new Error("series not created");
    const [source, sailed] = result.trips;
    if (!source || !sailed) throw new Error("expected two instances");

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

  it("cancels every upcoming date at once, leaves past dates alone, and stops the repeat", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Friday Night Dive",
        capacity: 8,
        plannedDives: 1,
        anchorDate: "2030-08-03", // a Saturday, before `now`
        endsOn: "2030-08-31",
        template: {
          startsAt: at("2030-08-03T22:00:00.000Z"),
          endsAt: at("2030-08-04T00:00:00.000Z"),
        },
      }),
    );
    if (!result) throw new Error("series not created");
    const [past, , upcoming] = result.trips;
    if (!past || !upcoming) throw new Error("expected instances");

    const cancelled = await cancelFutureSeriesTrips(db, shop.id, result.series.id, now);
    expect(cancelled).toBe(3);

    expect((await getTripWithBooked(db, shop.id, past.id))?.status).toBe("scheduled");
    const summary = await getTripSeriesSummary(db, shop.id, upcoming.id, now);
    expect(summary?.futureScheduledCount).toBe(0);

    // …and the run is closed, so the nightly roll cannot re-fill what staff
    // just cleared. Without this, cancelling would undo itself by morning.
    const before = await occurrenceDatesOf(db, result.series.id);
    await rollAllSeriesForward(db, now);
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual(before);
  });

  it("stops and restarts a repeat without disturbing the dates already on the board", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-09-07T12:00:00.000Z");
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");

    const stopped = await setSeriesRepeat(db, shop.id, result.series.id, false, now);
    expect(stopped).toEqual({ created: 0 });
    const afterStop = await occurrenceDatesOf(db, result.series.id);
    expect(afterStop.length).toBeGreaterThan(0);
    expect((await getTripSeriesById(db, shop.id, result.series.id))?.endsOn).toBe("2030-09-07");

    // A stopped run generates nothing, however far the clock moves.
    await rollSeriesForward(db, shop.id, result.series.id, at("2030-11-07T12:00:00.000Z"));
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual(afterStop);

    // Starting again re-opens it and refills the horizon in the same call.
    const restarted = await setSeriesRepeat(
      db,
      shop.id,
      result.series.id,
      true,
      at("2030-11-07T12:00:00.000Z"),
    );
    expect(restarted?.created).toBeGreaterThan(0);
    expect((await getTripSeriesById(db, shop.id, result.series.id))?.endsOn).toBeNull();
    expect((await occurrenceDatesOf(db, result.series.id)).length).toBeGreaterThan(
      afterStop.length,
    );
  });

  it("widens a cadence in place: a second weekday appears on the board", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-09-07T12:00:00.000Z");
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    const before = await occurrenceDatesOf(db, result.series.id);

    const updated = await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([WED, SAT]), endsOn: null },
      now,
    );
    expect(updated?.created).toBeGreaterThan(0);
    // Nothing is orphaned by adding a day, so there is nothing to ask about.
    expect(updated?.offCadence).toBe(0);
    const after = await occurrenceDatesOf(db, result.series.id);
    expect(after.length).toBeGreaterThan(before.length);
    // Every Saturday that was there is still there, and Wednesdays joined it.
    expect(after).toEqual(expect.arrayContaining(before));
  });

  it("narrowing a cadence cancels nothing — it reports what no longer fits", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-09-07T12:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: weekdaySetFrom([WED, SAT]) }),
    );
    if (!result) throw new Error("series not created");
    const before = await occurrenceDatesOf(db, result.series.id);

    // Drop Wednesday. The Wednesdays already on the board are ordinary trips.
    const updated = await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null },
      now,
    );
    expect(updated?.offCadence).toBeGreaterThan(0);
    // The whole point: saving a narrower cadence took nothing off the board.
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual(before);
    const stale = await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now);
    expect(stale.every((trip) => calendarDateWeekday(trip.occurrenceDate) === WED)).toBe(true);
  });

  it("reports how many of the orphaned dates carry divers before anything is cancelled", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-09-07T12:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: weekdaySetFrom([WED, SAT]) }),
    );
    if (!result) throw new Error("series not created");
    const wednesday = result.trips.find(
      (trip) => trip.seriesOccurrenceDate && calendarDateWeekday(trip.seriesOccurrenceDate) === WED,
    );
    if (!wednesday) throw new Error("expected a Wednesday instance");
    const [diver] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!diver) throw new Error("seed people missing");
    await db.insert(bookings).values({ shopId: shop.id, tripId: wednesday.id, personId: diver.id });

    await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null },
      now,
    );
    const stale = await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now);
    const booked = stale.find((trip) => trip.id === wednesday.id);
    // The head count is the whole reason this is an offer and not a side effect.
    expect(booked?.booked).toBe(1);
  });

  it("cancels the orphaned dates only when asked, and leaves the ones that sailed", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-09-30T12:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: weekdaySetFrom([WED, SAT]) }),
    );
    if (!result) throw new Error("series not created");
    // A Wednesday that has already departed by `now` — history, never a
    // schedule edit to make.
    const pastWednesday = result.trips.find(
      (trip) =>
        trip.startsAt < now &&
        trip.seriesOccurrenceDate &&
        calendarDateWeekday(trip.seriesOccurrenceDate) === WED,
    );
    if (!pastWednesday) throw new Error("expected a departed Wednesday");

    await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null },
      now,
    );
    const cancelled = await cancelOffCadenceSeriesTrips(db, shop.id, result.series.id, now);
    expect(cancelled).toBeGreaterThan(0);
    expect(await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now)).toEqual([]);
    expect((await getTripWithBooked(db, shop.id, pastWednesday.id))?.status).toBe("scheduled");
    // Cancelled, not deleted: every one is reinstatable from its own page.
    expect(await occurrenceDatesOf(db, result.series.id)).toContain(
      pastWednesday.seriesOccurrenceDate,
    );
  });

  it("keeps the phase when the interval changes — the anchor never moves", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-09-07T12:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, endsOn: "2030-10-19" }),
    );
    if (!result) throw new Error("series not created");

    await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 2, weekdays: weekdaySetFrom([SAT]), endsOn: "2030-10-19" },
      now,
    );
    // Fortnightly *from the anchor's own week*, not from the day of the edit:
    // the surviving dates are the anchor and every second Saturday after it.
    const stale = await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now);
    const staleDates = stale.map((trip) => trip.occurrenceDate);
    expect(staleDates).toEqual(["2030-09-14", "2030-09-28", "2030-10-12"]);
  });

  it("refuses a cadence edit that would leave the run unable to generate", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    expect(
      await updateSeriesCadence(db, shop.id, result.series.id, {
        intervalWeeks: 1,
        weekdays: 0,
        endsOn: null,
      }),
    ).toBeNull();
    // And the stored cadence is untouched, so the board still matches its own
    // description.
    expect((await getTripSeriesById(db, shop.id, result.series.id))?.weekdayMask).toBe(
      weekdaySetFrom([SAT]),
    );
  });

  it("leaves a deploy-window series inert instead of failing the sweep every night", async () => {
    const { db, shop } = await seededShopContext();
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    // Exactly what the release *before* the cadence columns writes: a row on
    // their inert defaults. It can never generate, so the nightly pass must not
    // keep reporting it as a failure — that is a permanently red monitor for a
    // row nothing is wrong with.
    await db
      .update(tripSeries)
      .set({ weekdayMask: 0, anchorDate: "" })
      .where(eq(tripSeries.id, result.series.id));

    const sweep = await rollAllSeriesForward(db, at("2030-10-07T12:00:00.000Z"));
    expect(sweep.failures).toBe(0);
    expect(sweep.seriesConsidered).toBe(0);
  });

  it("rolls least-recently-rolled first, so no run can be starved by another", async () => {
    const { db, shop } = await seededShopContext();
    const now = at("2030-10-07T12:00:00.000Z");
    const first = await createTripSeries(db, seriesInput({ shopId: shop.id, title: "First" }));
    const second = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, title: "Second", anchorDate: "2030-09-01" }),
    );
    if (!first || !second) throw new Error("series not created");

    // The older run has already been rolled tonight; the newer one never has.
    await db
      .update(tripSeries)
      .set({ lastRolledAt: now })
      .where(eq(tripSeries.id, first.series.id));
    await rollAllSeriesForward(db, now);

    // Both carry a stamp afterwards — the sweep records every attempt, which is
    // what stops a failing run holding the front of the queue forever.
    const rows = await db
      .select({ id: tripSeries.id, lastRolledAt: tripSeries.lastRolledAt })
      .from(tripSeries)
      .where(eq(tripSeries.shopId, shop.id));
    expect(rows.every((row) => row.lastRolledAt !== null)).toBe(true);
  });

  it("rejects a series with an invalid dive count", async () => {
    const { db, shop } = await seededShopContext();
    expect(
      await createTripSeries(db, seriesInput({ shopId: shop.id, plannedDives: 9 })),
    ).toBeNull();
  });

  it("rejects a cadence that names no weekday at all", async () => {
    const { db, shop } = await seededShopContext();
    // The refusal that matters: an empty set would create a series row with no
    // dates and no complaint.
    expect(await createTripSeries(db, seriesInput({ shopId: shop.id, weekdays: 0 }))).toBeNull();
  });

  it("gives every occurrence of a multi-day series its own meeting days", async () => {
    const { db, shop } = await seededShopContext();
    const created = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Weekend course",
        capacity: 6,
        anchorDate: "2030-10-05", // a Saturday
        endsOn: "2030-10-12",
        template: {
          startsAt: at("2030-10-05T12:00:00.000Z"),
          endsAt: at("2030-10-06T16:00:00.000Z"),
          scheduleDays: [
            {
              dayNumber: 1,
              startsAt: at("2030-10-05T12:00:00.000Z"),
              endsAt: at("2030-10-05T16:00:00.000Z"),
            },
            {
              dayNumber: 2,
              startsAt: at("2030-10-06T12:00:00.000Z"),
              endsAt: at("2030-10-06T16:00:00.000Z"),
            },
          ],
        },
      }),
    );
    if (!created) throw new Error("series not created");
    expect(created.trips).toHaveLength(2);

    const weekStarts = [];
    for (const instance of created.trips) {
      const days = await listTripScheduleDays(db, shop.id, instance.id);
      expect(days).toHaveLength(2);
      weekStarts.push(days.map((day) => day.startsAt.toISOString()));
    }
    // Each week's second day belongs to that week, not to the first occurrence's.
    expect(weekStarts).toEqual([
      ["2030-10-05T12:00:00.000Z", "2030-10-06T12:00:00.000Z"],
      ["2030-10-12T12:00:00.000Z", "2030-10-13T12:00:00.000Z"],
    ]);
  });

  it("holds the shop's published hour across a daylight-saving change", async () => {
    const { db, shop } = await seededShopContext();
    // US DST ends 2030-11-03. A 07:00 New York departure is 11:00Z before it
    // and 12:00Z after — the *instant* moves so the clock on the wall doesn't.
    const created = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        anchorDate: "2030-10-26", // a Saturday
        endsOn: "2030-11-09",
        template: {
          startsAt: at("2030-10-26T11:00:00.000Z"),
          endsAt: at("2030-10-26T15:00:00.000Z"),
        },
      }),
    );
    if (!created) throw new Error("series not created");
    expect(created.trips.map((trip) => trip.startsAt.toISOString())).toEqual([
      "2030-10-26T11:00:00.000Z",
      "2030-11-02T11:00:00.000Z",
      "2030-11-09T12:00:00.000Z",
    ]);
  });
});
