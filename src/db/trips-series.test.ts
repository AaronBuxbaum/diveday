import type { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { calendarDateWeekday } from "@/lib/calendar-date";
import { queryTimingLogger, withQueryStats } from "@/lib/observability/query-timing";
import { EVERY_WEEKDAY, weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import { fakeCheckout, fakeEmail } from "@/test/fakes";
import { callTripBlowout, getTripBlowout } from "./blowouts";
import { createBookingParty } from "./bookings";
import { listDiveSites } from "./dive-sites";
import { getBookingPayment, setBookingPayment } from "./payments";
import {
  bookings,
  courses,
  people,
  rollCallCrewEvents,
  rollCallEvents,
  tripRequirements,
  tripSeries,
  trips,
} from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { createTripLens } from "./trip-lenses";
import {
  applyDetailsToFutureSeries,
  cancelFutureSeriesTrips,
  createTrip,
  createTripSeries,
  deleteTrip,
  getLatestSeriesInstance,
  getSeriesStandingCrew,
  getTripCrewAssignments,
  getTripSeriesById,
  getTripSeriesSummary,
  getTripWithBooked,
  listOffCadenceSeriesTrips,
  listRunningPublicSeries,
  listStaff,
  listTripScheduleDays,
  moveTrip,
  type NewTripSeries,
  rollAllSeriesForward,
  rollSeriesForward,
  setSeriesRepeat,
  setSeriesStandingCrew,
  setTripCrew,
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
const TUE = 2;
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

/** The seeded owner, who makes the series-wide calls in these tests. */
async function ownerId(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  return owner.id;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("recurring trip series (in-memory PGlite)", () => {
  it("materializes a weekly run of identical, independent trips", async () => {
    const { db, shop } = ctx;

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
      // The same gates the one-at-a-time insert wrote: waiver on, and a
      // course-less day's Open Water baseline (code review 2026-10-13b, item 40).
      expect(reqs[0]).toMatchObject({
        shopId: shop.id,
        requiresWaiver: true,
        minimumCertificationLevel: "open_water",
        requiredSpecialties: [],
        requiresNitrox: false,
        requiresPayment: false,
      });
    }

    const summary = await getTripSeriesSummary(db, shop.id, firstInstance.id);
    expect(summary?.intervalWeeks).toBe(1);
    expect(summary?.scheduledCount).toBe(3);
    expect(summary?.endsOn).toBe("2030-09-21");
  });

  it("materializes a private charter series, keeping all occurrences private", async () => {
    const { db, shop } = ctx;

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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

  /**
   * **A repeating departure keeps the shop's trip tag** (issue #1492).
   *
   * `lens_id` was dropped on both of a series' write paths — the seed instance
   * `createTripSeries` inserts, and every occurrence `materializeWindow` rolls
   * forward. `NewTripSeries` carries it and the schedule board passes it, so a
   * shop setting a trip tag on a repeating Saturday typed a word that was
   * silently discarded on the very first instance and on all of them after.
   *
   * It is not only a staff-facing loss: the public lens rail narrows in SQL on
   * `trips.lens_id`, so those departures were missing from the list a diver
   * reaches by tapping the shop's own word.
   */
  it("carries the shop's trip tag onto the seed instance and every roll", async () => {
    const { db, shop } = ctx;
    const lens = await createTripLens(db, shop.id, "After dark");
    if (!lens) throw new Error("lens not created");

    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, lensId: lens.id, weekdays: EVERY_WEEKDAY, endsOn: null }),
    );
    if (!result) throw new Error("series not created");

    // The seed instance, which was the one a staffer saw immediately.
    const [seed] = result.trips;
    expect(seed?.lensId).toBe(lens.id);
    // And every occurrence materialized with it.
    expect(result.trips.every((trip) => trip.lensId === lens.id)).toBe(true);

    // Then the nightly horizon roll, which is the path that would have kept
    // producing wordless departures forever.
    const rolled = await rollSeriesForward(
      db,
      shop.id,
      result.series.id,
      at("2030-10-07T12:00:00.000Z"),
    );
    expect(rolled?.created).toBeGreaterThan(0);
    const materialized = await db
      .select({ lensId: trips.lensId })
      .from(trips)
      .where(and(eq(trips.seriesId, result.series.id), isNull(trips.deletedAt)));
    expect(materialized.every((trip) => trip.lensId === lens.id)).toBe(true);
  });

  it("leaves a series with no kind of day without one", async () => {
    // The inverse, so the fix above cannot be a blanket write.
    const { db, shop } = ctx;
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, endsOn: "2030-09-21" }),
    );
    if (!result) throw new Error("series not created");
    expect(result.trips.every((trip) => trip.lensId === null)).toBe(true);
  });

  it("rolling twice over the same window changes nothing the second time", async () => {
    const { db, shop } = ctx;
    const result = await createTripSeries(db, seriesInput({ shopId: shop.id }));
    if (!result) throw new Error("series not created");
    const now = at("2030-10-07T12:00:00.000Z");
    const first = await rollSeriesForward(db, shop.id, result.series.id, now);
    const second = await rollSeriesForward(db, shop.id, result.series.id, now);
    expect(first?.created).toBeGreaterThan(0);
    expect(second?.created).toBe(0);
  });

  it("never puts a deleted date back on the board", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
      { bookedAs: "diver", shopId: shop.id, tripId: crowded.id, personId: p1.id },
      { bookedAs: "diver", shopId: shop.id, tripId: crowded.id, personId: p2.id },
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

  it("bumps the calendar revision only on the siblings whose dive sites actually moved", async () => {
    // Issue #1165: `trips.revision` ships as RFC 5545 SEQUENCE, so a bulk apply
    // that bumped every instance would re-alert every diver on a date whose day
    // did not change at all.
    const { db, shop } = ctx;
    const now = at("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Wednesday Reef",
        anchorDate: "2030-09-04",
        weekdays: weekdaySetFrom([WED]),
        endsOn: "2030-09-18",
        template: {
          startsAt: at("2030-09-04T11:00:00.000Z"),
          endsAt: at("2030-09-04T15:00:00.000Z"),
        },
      }),
    );
    if (!result) throw new Error("series not created");
    const [source, alreadyThere, stillElsewhere] = result.trips;
    if (!source || !alreadyThere || !stillElsewhere) throw new Error("expected three instances");

    const [siteOne, siteTwo] = await listDiveSites(db, shop.id);
    if (!siteOne || !siteTwo) throw new Error("seeded shop needs two dive sites");
    const plan = {
      capacity: source.capacity,
      plannedDives: source.plannedDives,
      dives: [{ diveSiteId: siteOne.id }, { diveSiteId: siteTwo.id }],
    };

    await updateTrip(db, shop.id, source.id, {
      title: source.title,
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      ...plan,
    });
    // One sibling is already running exactly these sites, so the apply changes
    // nothing about its day.
    await updateTrip(db, shop.id, alreadyThere.id, {
      title: alreadyThere.title,
      startsAt: alreadyThere.startsAt,
      endsAt: alreadyThere.endsAt,
      ...plan,
    });
    const settled = await getTripWithBooked(db, shop.id, alreadyThere.id);
    expect(settled?.revision).toBe(1);

    const applied = await applyDetailsToFutureSeries(db, shop.id, result.series.id, source.id, now);
    expect(applied).toEqual({ updated: 2, skipped: 0 });

    expect((await getTripWithBooked(db, shop.id, alreadyThere.id))?.revision).toBe(1);
    expect((await getTripWithBooked(db, shop.id, stillElsewhere.id))?.revision).toBe(1);
  });

  it("skips a sibling whose recorded roll call would be orphaned by the new dive count", async () => {
    const { db, shop } = ctx;
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
      .values({ bookedAs: "diver", shopId: shop.id, tripId: sailed.id, personId: p1.id })
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

  it("skips a sibling whose only after-dive history is a crew roll call", async () => {
    // Batch 6, item 5: the series floor reads crew results too.
    const { db, shop } = ctx;
    const now = at("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Tuesday Wall",
        capacity: 10,
        anchorDate: "2030-09-03",
        weekdays: weekdaySetFrom([TUE]),
        endsOn: "2030-09-10",
        template: {
          startsAt: at("2030-09-03T11:00:00.000Z"),
          endsAt: at("2030-09-03T15:00:00.000Z"),
        },
      }),
    );
    if (!result) throw new Error("series not created");
    const [source, sailed] = result.trips;
    if (!source || !sailed) throw new Error("expected two instances");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: sailed.id,
      personId: staff.person.id,
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
    expect((await getTripWithBooked(db, shop.id, sailed.id))?.plannedDives).toBe(2);
  });

  it("cancels every upcoming date at once, leaves past dates alone, and stops the repeat", async () => {
    const { db, shop } = ctx;
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

    const cancelled = await cancelFutureSeriesTrips(db, {
      shopId: shop.id,
      seriesId: result.series.id,
      calledByPersonId: await ownerId(db, shop.id),
      now,
      provider: fakeEmail().provider,
    });
    expect(cancelled).toMatchObject({ cancelled: 3, skipped: 0, divers: 0 });
    expect(cancelled?.tripIds).toHaveLength(3);

    expect((await getTripWithBooked(db, shop.id, past.id))?.status).toBe("scheduled");
    const summary = await getTripSeriesSummary(db, shop.id, upcoming.id, now);
    expect(summary?.futureScheduledCount).toBe(0);

    // …and the run is closed, so the nightly roll cannot re-fill what staff
    // just cleared. Without this, cancelling would undo itself by morning.
    const before = await occurrenceDatesOf(db, result.series.id);
    await rollAllSeriesForward(db, now);
    expect(await occurrenceDatesOf(db, result.series.id)).toEqual(before);
  });

  describe("a run's divers are told, refunded and recorded, like a blow-out (2026-10-12)", () => {
    beforeEach(() => {
      vi.stubEnv("APP_HOST", "https://diveday.example");
    });

    async function bookedRun() {
      const { db, shop } = ctx;
      const now = at("2030-08-15T00:00:00.000Z");
      const result = await createTripSeries(
        db,
        seriesInput({ shopId: shop.id, title: "Saturday Wreck", endsOn: "2030-09-21" }),
      );
      if (!result) throw new Error("series not created");
      const [first, second] = result.trips;
      if (!first || !second) throw new Error("expected instances");
      const party = await createBookingParty(db, [
        {
          actor: "staff" as const,
          shopId: shop.id,
          tripId: first.id,
          fullName: "Ada Run",
          email: "ada.run@example.com",
        },
      ]);
      const party2 = await createBookingParty(db, [
        {
          actor: "staff" as const,
          shopId: shop.id,
          tripId: second.id,
          fullName: "Ben Run",
          email: "ben.run@example.com",
        },
      ]);
      if (!party.ok || !party2.ok) throw new Error("roster could not be booked");
      return {
        db,
        shop,
        now,
        result,
        paidBooking: party.bookings[0]?.bookingId as string,
        unpaidBooking: party2.bookings[0]?.bookingId as string,
      };
    }

    it("sends each booked diver one message that names the run, never the weather", async () => {
      const run = await bookedRun();
      const email = fakeEmail();
      const outcome = await cancelFutureSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: email.provider,
        checkout: fakeCheckout(),
      });
      expect(outcome).toMatchObject({ cancelled: 3, skipped: 0, divers: 2 });
      const sends = email.sent.filter((sent) => sent.kind === "trip_blowout");
      expect(sends.map((sent) => sent.to).sort()).toEqual([
        "ada.run@example.com",
        "ben.run@example.com",
      ]);
      for (const sent of sends) {
        if (sent.kind !== "trip_blowout") continue;
        expect(sent.cause).toBe("run_ended");
        // Nobody is offered another date of the run being cancelled.
        for (const alternative of sent.alternatives) {
          for (const trip of run.result.trips) {
            expect(alternative.bookingUrl).not.toContain(trip.id);
          }
        }
      }
      // Each date keeps a cascade record staff can work, marked as a run that stopped.
      const record = await getTripBlowout(run.db, run.shop.id, run.result.trips[0]?.id as string);
      expect(record?.cause).toBe("run_ended");
      expect(record?.divers).toHaveLength(1);
    });

    it("refunds a card-paid seat by itself and leaves an unpaid one with nothing to move", async () => {
      const run = await bookedRun();
      await upsertShopStripeAccount(run.db, run.shop.id, "acct_series_cancel");
      await setShopStripeAccountStatus(run.db, "acct_series_cancel", {
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      });
      await setBookingPayment(run.db, {
        shopId: run.shop.id,
        bookingId: run.paidBooking,
        status: "paid",
        amountCents: 15_000,
        currency: "usd",
        provider: "stripe",
        providerRef: "cs_series_paid",
      });
      const summary = await getTripSeriesSummary(
        run.db,
        run.shop.id,
        run.result.trips[0]?.id as string,
        run.now,
      );
      // The confirm counts who it reaches, and who has paid, before the tap.
      expect(summary?.futureBookedCount).toBe(2);
      expect(summary?.futurePaidCount).toBe(1);

      const email = fakeEmail();
      await cancelFutureSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: email.provider,
        checkout: fakeCheckout(),
      });
      const stories = new Map(
        email.sent.flatMap((sent) =>
          sent.kind === "trip_blowout" ? [[sent.to, sent.paymentStory] as const] : [],
        ),
      );
      expect(stories.get("ada.run@example.com")).toBe("refunded");
      expect(stories.get("ben.run@example.com")).toBe("none");
      expect((await getBookingPayment(run.db, run.shop.id, run.paidBooking))?.status).toBe(
        "refunded",
      );
    });

    /** The first date blown out for weather, then put back on the board. */
    async function blownOutAndReinstated(run: Awaited<ReturnType<typeof bookedRun>>) {
      const first = run.result.trips[0];
      if (!first) throw new Error("expected a first date");
      const blown = await callTripBlowout(run.db, {
        shopId: run.shop.id,
        tripId: first.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: fakeEmail().provider,
        checkout: fakeCheckout(),
      });
      expect(blown.ok).toBe(true);
      await setTripStatus(run.db, run.shop.id, first.id, "scheduled", run.now);
      return first;
    }

    // Review 1b (2026-10-12): a reinstated date the run cancel calls off again
    // is cancelled because the run ended, not because of the old weather.
    it("tells a diver on a reinstated date that the run ended, not the old weather", async () => {
      const run = await bookedRun();
      const first = await blownOutAndReinstated(run);
      const party = await createBookingParty(run.db, [
        {
          actor: "staff" as const,
          shopId: run.shop.id,
          tripId: first.id,
          fullName: "Cy Back",
          email: "cy.back@example.com",
        },
      ]);
      if (!party.ok) throw new Error("could not book the reinstated date");
      const email = fakeEmail();
      await cancelFutureSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: email.provider,
        checkout: fakeCheckout(),
      });
      const told = email.sent.find(
        (sent) => sent.kind === "trip_blowout" && sent.to === "cy.back@example.com",
      );
      expect(told?.kind === "trip_blowout" && told.cause).toBe("run_ended");
      expect((await getTripBlowout(run.db, run.shop.id, first.id))?.cause).toBe("run_ended");
    });

    // Security D2 (2026-10-12): an earlier blow-out record must not let the run
    // cancel call off a reinstated date whose boarding has begun.
    it("leaves a reinstated date with boarding begun on the board, counted as skipped", async () => {
      const run = await bookedRun();
      const first = await blownOutAndReinstated(run);
      const [staff] = await listStaff(run.db, run.shop.id);
      if (!staff) throw new Error("seed staff missing");
      await run.db.insert(rollCallEvents).values({
        shopId: run.shop.id,
        tripId: first.id,
        bookingId: run.paidBooking,
        recordedByPersonId: staff.person.id,
        status: "boarded",
        checkpoint: "departure",
        occurredAt: run.now,
      });
      const outcome = await cancelFutureSeriesTrips(run.db, {
        shopId: run.shop.id,
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: fakeEmail().provider,
        checkout: fakeCheckout(),
      });
      expect(outcome?.skipped).toBe(1);
      expect((await getTripWithBooked(run.db, run.shop.id, first.id))?.status).toBe("scheduled");
    });

    it("touches nothing of another shop's: a foreign series id cancels no date anywhere", async () => {
      const run = await bookedRun();
      const email = fakeEmail();
      const outcome = await cancelFutureSeriesTrips(run.db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        seriesId: run.result.series.id,
        calledByPersonId: await ownerId(run.db, run.shop.id),
        now: run.now,
        provider: email.provider,
        checkout: fakeCheckout(),
      });
      expect(outcome).toBeNull();
      expect(email.sent).toHaveLength(0);
      for (const trip of run.result.trips) {
        expect((await getTripWithBooked(run.db, run.shop.id, trip.id))?.status).toBe("scheduled");
      }
      expect((await getTripSeriesById(run.db, run.shop.id, run.result.series.id))?.endsOn).toBe(
        "2030-09-21",
      );
    });
  });

  it("stops and restarts a repeat without disturbing the dates already on the board", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

  it("reports how many of the orphaned dates carry divers before anything is canceled", async () => {
    const { db, shop } = ctx;
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
    await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: shop.id, tripId: wednesday.id, personId: diver.id });

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

  it("keeps the phase when the interval changes — the anchor never moves", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
    for (const plannedDives of [9, 5]) {
      expect(await createTripSeries(db, seriesInput({ shopId: shop.id, plannedDives }))).toBeNull();
    }
  });

  it("rejects a cadence that names no weekday at all", async () => {
    const { db, shop } = ctx;
    // The refusal that matters: an empty set would create a series row with no
    // dates and no complaint.
    expect(await createTripSeries(db, seriesInput({ shopId: shop.id, weekdays: 0 }))).toBeNull();
  });

  it("gives every occurrence of a multi-day series its own meeting days", async () => {
    const { db, shop } = ctx;
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
    const { db, shop } = ctx;
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

/**
 * **The nightly roll cannot re-mint a self-guided course session** (issue
 * #1342).
 *
 * `insertTripInstance` refuses the combination for all three creation doors,
 * and this is the one with nobody in the loop: `materializeWindow` copies
 * `template.trip.selfGuided` into every instance it makes, every night,
 * forever. A template that somehow held the mark would stamp it onto dates
 * nobody was looking at, indefinitely.
 *
 * "Covered by construction" is not the same as covered. `duplicateTrip` was
 * covered by construction too, right up until a PR #1041 review found it
 * copying `isPrivate` and not this column at all.
 *
 * The mark is written behind the writer's back, because that is now the only
 * way to reach the state — which is also the shape a row predating the rule
 * would have.
 */
describe("the horizon roll never carries a self-guided mark onto a course session", () => {
  it("materializes course instances with the mark cleared", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    if (!course) throw new Error("seeded shop has no course");

    const created = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, courseId: course.id, endsOn: null }),
    );
    if (!created) throw new Error("series not created");
    expect(created.trips.length).toBeGreaterThan(0);

    // Every instance the create pass made is already clean — the same writer.
    for (const trip of created.trips) expect(trip.selfGuided).toBe(false);

    // Now put the state on the whole series behind the writer's back, so the
    // roll's template read finds it and tries to copy it forward.
    await db.update(trips).set({ selfGuided: true }).where(eq(trips.seriesId, created.series.id));

    const instanceIds = async () =>
      new Set(
        (
          await db.select({ id: trips.id }).from(trips).where(eq(trips.seriesId, created.series.id))
        ).map((row) => row.id),
      );
    // Diffed by id rather than by date: the rows the create pass already made
    // are the ones just marked, so a date filter would assert against them and
    // fail for the wrong reason.
    const before = await instanceIds();

    // A year on, so the horizon has moved and there are new dates to fill.
    const rolled = await rollSeriesForward(
      db,
      shop.id,
      created.series.id,
      new Date("2031-09-07T12:00:00.000Z"),
    );
    expect(rolled).not.toBeNull();

    const materialized = await db
      .select({ id: trips.id, selfGuided: trips.selfGuided })
      .from(trips)
      .where(eq(trips.seriesId, created.series.id));
    const fresh = materialized.filter((trip) => !before.has(trip.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const trip of fresh) expect(trip.selfGuided).toBe(false);
  });
});

describe("a run's standing crew (2026-10-12): applied per date, never assumed", () => {
  /** Two staff members with roles a charter can use, and a non-staff diver. */
  async function crewOf(db: Awaited<ReturnType<typeof seededShopContext>>["db"], shopId: string) {
    const staff = await listStaff(db, shopId);
    const captain = staff.find((entry) => entry.roles.includes("captain")) ?? staff[0];
    const other = staff.find((entry) => entry.person.id !== captain?.person.id);
    if (!captain || !other) throw new Error("seeded shop needs two staff members");
    return { captain: captain.person.id, other: other.person.id };
  }

  async function runWithCrew() {
    const { db, shop } = ctx;
    const now = at("2030-08-15T00:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, title: "Saturday Crew Run", endsOn: null }),
    );
    if (!result) throw new Error("series not created");
    const [source] = result.trips;
    if (!source) throw new Error("expected a first date");
    const crew = await crewOf(db, shop.id);
    expect(
      await setTripCrew(db, shop.id, source.id, [
        { personId: crew.captain, tripRole: "captain" },
        crew.other,
      ]),
    ).toBe(true);
    return { db, shop, now, result, source, crew };
  }

  const crewOn = async (
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
    tripId: string,
  ) =>
    (await getTripCrewAssignments(db, shopId, tripId))
      .map((row) => `${row.personId}:${row.tripRole ?? ""}`)
      .sort();

  it("crews every upcoming date like this one, roles included, and remembers it", async () => {
    const run = await runWithCrew();
    const outcome = await setSeriesStandingCrew(run.db, {
      shopId: run.shop.id,
      seriesId: run.result.series.id,
      sourceTripId: run.source.id,
      standing: true,
      actorPersonId: null,
      now: run.now,
    });
    expect(outcome?.skipped).toBe(0);
    expect(outcome?.updated).toBe(run.result.trips.length - 1);
    const expected = await crewOn(run.db, run.shop.id, run.source.id);
    for (const trip of run.result.trips) {
      expect(await crewOn(run.db, run.shop.id, trip.id)).toEqual(expected);
    }
    expect(
      (await getSeriesStandingCrew(run.db, run.shop.id, run.result.series.id)).length,
    ).toBeGreaterThan(0);
  });

  it("leaves a date with its own crew when somebody on this one is on another boat then", async () => {
    const run = await runWithCrew();
    const [, clashing] = run.result.trips;
    if (!clashing) throw new Error("expected a second date");
    // The other crew member is already working an overlapping charter that day.
    const elsewhere = await createTrip(run.db, {
      shopId: run.shop.id,
      title: "Private Charter",
      startsAt: clashing.startsAt,
      endsAt: clashing.endsAt,
      capacity: 6,
      plannedDives: 2,
    });
    if (!elsewhere) throw new Error("charter not created");
    expect(await setTripCrew(run.db, run.shop.id, elsewhere.id, [run.crew.other])).toBe(true);

    const outcome = await setSeriesStandingCrew(run.db, {
      shopId: run.shop.id,
      seriesId: run.result.series.id,
      sourceTripId: run.source.id,
      standing: true,
      actorPersonId: null,
      now: run.now,
    });
    expect(outcome?.skipped).toBe(1);
    expect(await crewOn(run.db, run.shop.id, clashing.id)).toEqual([]);
  });

  it("seats the crew on every date the horizon roll adds, each date asked again", async () => {
    const run = await runWithCrew();
    await setSeriesStandingCrew(run.db, {
      shopId: run.shop.id,
      seriesId: run.result.series.id,
      sourceTripId: run.source.id,
      standing: true,
      actorPersonId: null,
      now: run.now,
    });
    const before = new Set(run.result.trips.map((trip) => trip.id));
    // Somebody on the crew is booked elsewhere on a date the roll is about to add.
    // A Saturday beyond the first window; 07:00 in New York is 12:00Z in winter.
    const later = at("2031-02-01T12:00:00.000Z");
    const elsewhere = await createTrip(run.db, {
      shopId: run.shop.id,
      title: "Wreck Charter",
      startsAt: later,
      endsAt: at("2031-02-01T16:00:00.000Z"),
      capacity: 6,
      plannedDives: 2,
    });
    if (!elsewhere) throw new Error("charter not created");
    expect(await setTripCrew(run.db, run.shop.id, elsewhere.id, [run.crew.other])).toBe(true);

    const rolled = await rollSeriesForward(
      run.db,
      run.shop.id,
      run.result.series.id,
      at("2030-11-01T12:00:00.000Z"),
    );
    expect(rolled?.created).toBeGreaterThan(0);
    const added = (
      await run.db
        .select({ id: trips.id, startsAt: trips.startsAt })
        .from(trips)
        .where(and(eq(trips.seriesId, run.result.series.id), isNull(trips.deletedAt)))
    ).filter((trip) => !before.has(trip.id));
    expect(added.some((trip) => trip.startsAt.getTime() === later.getTime())).toBe(true);
    for (const trip of added) {
      const crew = await crewOn(run.db, run.shop.id, trip.id);
      if (trip.startsAt.getTime() === later.getTime()) {
        // Only the clashing person is left off, and only on that date.
        expect(crew).toEqual([`${run.crew.captain}:captain`]);
      } else {
        expect(crew).toEqual([`${run.crew.captain}:captain`, `${run.crew.other}:`].sort());
      }
    }
  });

  // Review 2b (2026-10-12): a called-off departure holds nobody's day, so its
  // old crew list must not keep the standing crew off the date it overlaps.
  it("seats the crew over a cancelled departure in the same hours", async () => {
    const run = await runWithCrew();
    await setSeriesStandingCrew(run.db, {
      shopId: run.shop.id,
      seriesId: run.result.series.id,
      sourceTripId: run.source.id,
      standing: true,
      actorPersonId: null,
      now: run.now,
    });
    const later = at("2031-02-01T12:00:00.000Z");
    const calledOff = await createTrip(run.db, {
      shopId: run.shop.id,
      title: "Old Wreck Run",
      startsAt: later,
      endsAt: at("2031-02-01T16:00:00.000Z"),
      capacity: 6,
      plannedDives: 2,
    });
    if (!calledOff) throw new Error("charter not created");
    expect(await setTripCrew(run.db, run.shop.id, calledOff.id, [run.crew.other])).toBe(true);
    await setTripStatus(run.db, run.shop.id, calledOff.id, "cancelled", run.now);

    await rollSeriesForward(
      run.db,
      run.shop.id,
      run.result.series.id,
      at("2030-11-01T12:00:00.000Z"),
    );
    const [rolled] = await run.db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.seriesId, run.result.series.id),
          eq(trips.startsAt, later),
          isNull(trips.deletedAt),
        ),
      );
    if (!rolled) throw new Error("the roll did not add the date");
    expect(await crewOn(run.db, run.shop.id, rolled.id)).toEqual(
      [`${run.crew.captain}:captain`, `${run.crew.other}:`].sort(),
    );
  });

  it("adds no crew to rolled dates while the run has no standing crew", async () => {
    const run = await runWithCrew();
    const before = new Set(run.result.trips.map((trip) => trip.id));
    await rollSeriesForward(
      run.db,
      run.shop.id,
      run.result.series.id,
      at("2030-11-01T12:00:00.000Z"),
    );
    const added = (
      await run.db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.seriesId, run.result.series.id), isNull(trips.deletedAt)))
    ).filter((trip) => !before.has(trip.id));
    expect(added.length).toBeGreaterThan(0);
    for (const trip of added) expect(await crewOn(run.db, run.shop.id, trip.id)).toEqual([]);
  });

  it("never strips the run's crew from a date with nobody on it, and turning it off changes no date", async () => {
    const run = await runWithCrew();
    const [, second] = run.result.trips;
    if (!second) throw new Error("expected a second date");
    // Second date has its own crew; the source date is emptied.
    expect(await setTripCrew(run.db, run.shop.id, second.id, [run.crew.captain])).toBe(true);
    expect(await setTripCrew(run.db, run.shop.id, run.source.id, [])).toBe(true);
    const fromEmpty = await setSeriesStandingCrew(run.db, {
      shopId: run.shop.id,
      seriesId: run.result.series.id,
      sourceTripId: run.source.id,
      standing: true,
      actorPersonId: null,
      now: run.now,
    });
    expect(fromEmpty).toEqual({ updated: 0, skipped: 0 });
    expect(await crewOn(run.db, run.shop.id, second.id)).toEqual([`${run.crew.captain}:`]);
    expect((await getSeriesStandingCrew(run.db, run.shop.id, run.result.series.id)).length).toBe(0);
  });

  it("seats nobody on a course date whose instructor is busy elsewhere, never a crew with no instructor", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    if (!course) throw new Error("seeded shop has no course");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    const helper = staff.find(
      (entry) => entry.person.id !== instructor?.person.id && !entry.roles.includes("instructor"),
    );
    if (!instructor || !helper) throw new Error("seeded shop needs an instructor and a helper");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, courseId: course.id, endsOn: null }),
    );
    if (!result) throw new Error("series not created");
    const [source] = result.trips;
    if (!source) throw new Error("expected a first date");
    expect(
      await setTripCrew(db, shop.id, source.id, [instructor.person.id, helper.person.id]),
    ).toBe(true);
    await setSeriesStandingCrew(db, {
      shopId: shop.id,
      seriesId: result.series.id,
      sourceTripId: source.id,
      standing: true,
      actorPersonId: null,
      now: at("2030-08-15T00:00:00.000Z"),
    });
    const later = at("2031-02-01T12:00:00.000Z");
    const elsewhere = await createTrip(db, {
      shopId: shop.id,
      title: "Private Lesson",
      startsAt: later,
      endsAt: at("2031-02-01T16:00:00.000Z"),
      capacity: 2,
      plannedDives: 1,
    });
    if (!elsewhere) throw new Error("lesson not created");
    expect(await setTripCrew(db, shop.id, elsewhere.id, [instructor.person.id])).toBe(true);

    await rollSeriesForward(db, shop.id, result.series.id, at("2030-11-01T12:00:00.000Z"));
    const [rolled] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.seriesId, result.series.id),
          eq(trips.startsAt, later),
          isNull(trips.deletedAt),
        ),
      );
    if (!rolled) throw new Error("the roll did not add the later date");
    // The helper alone would be a course session with no instructor: nobody.
    expect(await getTripCrewAssignments(db, shop.id, rolled.id)).toEqual([]);
    // …while a rolled date with the instructor free gets the whole crew.
    const [free] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.seriesId, result.series.id),
          eq(trips.startsAt, at("2031-02-08T12:00:00.000Z")),
          isNull(trips.deletedAt),
        ),
      );
    if (!free) throw new Error("the roll did not add the following date");
    expect((await getTripCrewAssignments(db, shop.id, free.id)).length).toBe(2);
  });

  // Review 1a (2026-10-12): the standing crew is the run's own fact, not
  // whatever the furthest-out date happens to carry. A date the roll seated
  // short — somebody busy, a course instructor away — must not become the crew
  // of every date after it.
  it("seats the whole crew on a later roll after a date the roll had to leave short", async () => {
    const run = await runWithCrew();
    await setSeriesStandingCrew(run.db, {
      shopId: run.shop.id,
      seriesId: run.result.series.id,
      sourceTripId: run.source.id,
      standing: true,
      actorPersonId: null,
      now: run.now,
    });
    // The furthest date the first roll adds (2030-11-01 + 120 days, a
    // Saturday); the other crew member is on another boat then.
    const clash = at("2031-03-01T12:00:00.000Z");
    const elsewhere = await createTrip(run.db, {
      shopId: run.shop.id,
      title: "Wreck Charter",
      startsAt: clash,
      endsAt: at("2031-03-01T16:00:00.000Z"),
      capacity: 6,
      plannedDives: 2,
    });
    if (!elsewhere) throw new Error("charter not created");
    expect(await setTripCrew(run.db, run.shop.id, elsewhere.id, [run.crew.other])).toBe(true);
    await rollSeriesForward(
      run.db,
      run.shop.id,
      run.result.series.id,
      at("2030-11-01T12:00:00.000Z"),
    );
    const dateAt = async (startsAt: Date) => {
      const [row] = await run.db
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.seriesId, run.result.series.id),
            eq(trips.startsAt, startsAt),
            isNull(trips.deletedAt),
          ),
        );
      if (!row) throw new Error(`the roll did not add ${startsAt.toISOString()}`);
      return row.id;
    };
    expect(await crewOn(run.db, run.shop.id, await dateAt(clash))).toEqual([
      `${run.crew.captain}:captain`,
    ]);

    // A week later the roll adds the next Saturday, past the short date.
    await rollSeriesForward(
      run.db,
      run.shop.id,
      run.result.series.id,
      at("2030-11-08T12:00:00.000Z"),
    );
    expect(await crewOn(run.db, run.shop.id, await dateAt(at("2031-03-08T12:00:00.000Z")))).toEqual(
      [`${run.crew.captain}:captain`, `${run.crew.other}:`].sort(),
    );
  });

  it("seats a course run's crew again once its instructor is free, after a date that had nobody", async () => {
    const { db, shop } = ctx;
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.shopId, shop.id))
      .limit(1);
    if (!course) throw new Error("seeded shop has no course");
    const staff = await listStaff(db, shop.id);
    const instructor = staff.find((entry) => entry.roles.includes("instructor"));
    const helper = staff.find(
      (entry) => entry.person.id !== instructor?.person.id && !entry.roles.includes("instructor"),
    );
    if (!instructor || !helper) throw new Error("seeded shop needs an instructor and a helper");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, courseId: course.id, endsOn: null }),
    );
    if (!result) throw new Error("series not created");
    const [source] = result.trips;
    if (!source) throw new Error("expected a first date");
    expect(
      await setTripCrew(db, shop.id, source.id, [instructor.person.id, helper.person.id]),
    ).toBe(true);
    await setSeriesStandingCrew(db, {
      shopId: shop.id,
      seriesId: result.series.id,
      sourceTripId: source.id,
      standing: true,
      actorPersonId: null,
      now: at("2030-08-15T00:00:00.000Z"),
    });
    // The instructor is away on the furthest date the first roll adds.
    const away = at("2031-03-01T12:00:00.000Z");
    const elsewhere = await createTrip(db, {
      shopId: shop.id,
      title: "Private Lesson",
      startsAt: away,
      endsAt: at("2031-03-01T16:00:00.000Z"),
      capacity: 2,
      plannedDives: 1,
    });
    if (!elsewhere) throw new Error("lesson not created");
    expect(await setTripCrew(db, shop.id, elsewhere.id, [instructor.person.id])).toBe(true);
    await rollSeriesForward(db, shop.id, result.series.id, at("2030-11-01T12:00:00.000Z"));
    await rollSeriesForward(db, shop.id, result.series.id, at("2030-11-08T12:00:00.000Z"));
    const [next] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.seriesId, result.series.id),
          eq(trips.startsAt, at("2031-03-08T12:00:00.000Z")),
          isNull(trips.deletedAt),
        ),
      );
    if (!next) throw new Error("the second roll did not add the next date");
    expect((await getTripCrewAssignments(db, shop.id, next.id)).length).toBe(2);
  });

  it("refuses a series that is not this shop's", async () => {
    const run = await runWithCrew();
    expect(
      await setSeriesStandingCrew(run.db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        seriesId: run.result.series.id,
        sourceTripId: run.source.id,
        standing: true,
        actorPersonId: null,
        now: run.now,
      }),
    ).toBeNull();
    expect((await getSeriesStandingCrew(run.db, run.shop.id, run.result.series.id)).length).toBe(0);
  });
});

describe("what keeps running past the public board's last month (2026-10-12)", () => {
  // Review 3a: the board's promise matches the nightly roll's own test of a
  // run that will generate — never one the roll skips or fails every night.
  it("never names a run the nightly roll cannot extend", async () => {
    const { db, shop } = ctx;
    const now = at("2030-08-15T00:00:00.000Z");
    const [course] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.shopId, shop.id), eq(courses.isActive, true)))
      .limit(1);
    if (!course) throw new Error("seeded shop has no active course");
    const courseRun = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, title: "Weekly Open Water", courseId: course.id }),
    );
    const unanchored = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Sunday Drift",
        weekdays: weekdaySetFrom([SUN]),
        anchorDate: "2030-09-08",
        template: {
          startsAt: at("2030-09-08T11:00:00.000Z"),
          endsAt: at("2030-09-08T15:00:00.000Z"),
        },
      }),
    );
    if (!courseRun || !unanchored) throw new Error("series not created");
    // The course is archived: the roll refuses to guess its cert gate.
    await db.update(courses).set({ isActive: false }).where(eq(courses.id, course.id));
    // A run on its inert pre-cadence default, which the sweep never considers.
    await db
      .update(tripSeries)
      .set({ anchorDate: "" })
      .where(eq(tripSeries.id, unanchored.series.id));
    expect(await listRunningPublicSeries(db, shop.id, now)).toEqual([]);
  });

  it("names open-ended public runs, never a finite, private or cancelled one", async () => {
    const { db, shop } = ctx;
    const now = at("2030-08-15T00:00:00.000Z");
    const open = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, title: "Saturday Two-Tank", endsOn: null }),
    );
    const finite = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, title: "Autumn Wrecks", endsOn: "2030-10-26" }),
    );
    const privateRun = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, title: "Club Charter", endsOn: null, isPrivate: true }),
    );
    const called = await createTripSeries(
      db,
      seriesInput({
        shopId: shop.id,
        title: "Monday Night",
        endsOn: null,
        anchorDate: "2030-09-02",
        weekdays: weekdaySetFrom([MON]),
        template: {
          startsAt: at("2030-09-02T23:00:00.000Z"),
          endsAt: at("2030-09-03T01:00:00.000Z"),
        },
      }),
    );
    if (!open || !finite || !privateRun || !called) throw new Error("series not created");
    // Every date of this one is cancelled, but the run itself was never stopped.
    for (const trip of called.trips) await setTripStatus(db, shop.id, trip.id, "cancelled", now);

    const running = await listRunningPublicSeries(db, shop.id, now);
    expect(running).toEqual([
      { title: "Saturday Two-Tank", intervalWeeks: 1, weekdayMask: weekdaySetFrom([SAT]) },
    ]);
    // Another shop's reader sees none of it.
    expect(await listRunningPublicSeries(db, "00000000-0000-4000-8000-000000000000", now)).toEqual(
      [],
    );
  });
});

/**
 * **A daily run over the horizon is written in batches, not one departure at
 * a time** (code review 2026-10-13b, item 40). Each departure used to be its
 * own chain of four inserts, so the schedule builder's "repeat daily" waited
 * on about 480 statements in a row; the nightly roll did the same per run.
 */
describe("what materializing a run sends", () => {
  it("writes 120 daily departures in a bounded number of statements", async () => {
    const { db: plain, shop } = await seededShopContext();
    const db = drizzle({
      client: plain.$client as PGlite,
      logger: queryTimingLogger,
    }) as unknown as typeof plain;
    const { result, stats } = await withQueryStats(() =>
      createTripSeries(
        db,
        seriesInput({
          shopId: shop.id,
          weekdays: EVERY_WEEKDAY,
          anchorDate: "2030-09-07",
          endsOn: "2031-01-04",
        }),
      ),
    );
    if (!result) throw new Error("series not created");
    expect(result.trips).toHaveLength(120);
    // Every one still gets its dives, its day and its requirement row.
    expect(await listTripScheduleDays(plain, shop.id, result.trips.at(-1)?.id ?? "")).toHaveLength(
      1,
    );
    expect(stats.queries).toBeLessThanOrEqual(MATERIALIZE_CEILING);
  });
});

// Measured 2026-10-13: 489 statements one departure at a time, 17 batched.
const MATERIALIZE_CEILING = 17;
