import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBoat, deleteBoat } from "../features/boats/store";
import { boats, shops, tripSeriesSkips, trips } from "./schema";
import {
  createTrip,
  createTripSeriesOrRefusal,
  DUPLICATE_BOAT_OUT_OF_SERVICE,
  duplicateTripOrRefusal,
  isSeriesBoatOutOfService,
  moveTrip,
  reinstateTrip,
  rollSeriesForward,
  setTripStatus,
} from "./trips";

/**
 * **A hull in the yard sails nothing, whichever door puts it on the water**
 * (issue #3915). The builder's single add and the trip details save already
 * refused it; a move, a copy and every week of a series now do too. The
 * window is shop-local calendar days, both ends inclusive: hull B is in the
 * yard 2030-12-10 to 12-12 here.
 */
const ctx = fileScopedShopContext();
const TZ = "America/New_York";
const SAT = 6;
const WED = 3;
const MON = 1;
const morning = (month: number, day: number, hour = 8) =>
  wallTimeToUtc({ year: 2030, month, day, hour, minute: 0 }, TZ);

async function hullInTheYard() {
  const { db, shop } = ctx;
  const boat = await createBoat(db, shop.id, "Hull B", 12);
  await db
    .update(boats)
    .set({
      outOfServiceFrom: "2030-12-10",
      outOfServiceUntil: "2030-12-12",
      outOfServiceReason: "Bottom paint",
    })
    .where(eq(boats.id, boat.id));
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Two-tank on Hull B",
    startsAt: morning(12, 3),
    endsAt: morning(12, 3, 12),
    capacity: 10,
    boatId: boat.id,
  });
  if (!trip) throw new Error("trip missing");
  return { db, shop, boat, trip };
}

/** Sunday 08:00 to Tuesday 17:00 on hull B, one span with no named days. */
async function liveaboardOn(boatId: string) {
  const { db, shop } = ctx;
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Liveaboard on Hull B",
    startsAt: morning(12, 1),
    endsAt: morning(12, 3, 17),
    capacity: 8,
    boatId,
  });
  if (!trip) throw new Error("liveaboard missing");
  return trip;
}

async function startOf(db: typeof ctx.db, tripId: string) {
  const [row] = await db
    .select({ startsAt: trips.startsAt })
    .from(trips)
    .where(eq(trips.id, tripId));
  return row?.startsAt;
}

describe("moveTrip onto a hull in the yard", () => {
  it.each([
    ["the first day", 10],
    ["a day inside", 11],
    ["the last day, inclusive", 12],
  ])("refuses a move onto %s, and leaves the departure where it was", async (_label, day) => {
    const { db, shop, trip } = await hullInTheYard();
    const outcome = await moveTrip(db, shop.id, trip.id, morning(12, day));
    expect(outcome).toEqual({ ok: false, reason: "boat_out_of_service", on: `2030-12-${day}` });
    expect(await startOf(db, trip.id)).toEqual(trip.startsAt);
  });

  it("reads the day in the shop's zone: 19:00 to 23:00 local on the 9th is the 9th", async () => {
    const { db, shop, trip } = await hullInTheYard();
    // 00:00Z to 04:00Z on the 10th, still the evening of the 9th in New York.
    const outcome = await moveTrip(db, shop.id, trip.id, morning(12, 9, 19));
    expect(outcome.ok).toBe(true);
  });

  it("refuses a four-hour run that leaves at 22:00 the night before and is out past midnight", async () => {
    const { db, shop, trip } = await hullInTheYard();
    expect(await moveTrip(db, shop.id, trip.id, morning(12, 9, 22))).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-10",
    });
  });

  it("moves freely the day after the window ends", async () => {
    const { db, shop, trip } = await hullInTheYard();
    expect((await moveTrip(db, shop.id, trip.id, morning(12, 13))).ok).toBe(true);
  });

  it("refuses a multi-day departure whose later day lands in the window", async () => {
    const { db, shop, boat } = await hullInTheYard();
    const course = await createTrip(db, {
      shopId: shop.id,
      title: "Two-day on Hull B",
      startsAt: morning(12, 1),
      endsAt: morning(12, 2, 16),
      capacity: 6,
      boatId: boat.id,
      scheduleDays: [
        { dayNumber: 1, startsAt: morning(12, 1), endsAt: morning(12, 1, 16) },
        { dayNumber: 2, startsAt: morning(12, 2), endsAt: morning(12, 2, 16) },
      ],
    });
    if (!course) throw new Error("course missing");
    // Day one on the 9th, day two on the 10th: in the yard.
    expect(await moveTrip(db, shop.id, course.id, morning(12, 9))).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-10",
    });
  });

  // Issue #3994: held is nights aboard, so a departure holds the hull from
  // its start through its end, not only on the day it leaves.
  it("refuses a liveaboard that leaves before the window and is still out in it", async () => {
    const { db, shop, boat } = await hullInTheYard();
    const trip = await liveaboardOn(boat.id);
    // Sunday the 8th to Tuesday the 10th: back on the yard's first day.
    expect(await moveTrip(db, shop.id, trip.id, morning(12, 8))).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-10",
    });
    expect(await startOf(db, trip.id)).toEqual(trip.startsAt);
  });

  it("moves a liveaboard that is back the day before the window opens", async () => {
    const { db, shop, boat } = await hullInTheYard();
    const trip = await liveaboardOn(boat.id);
    // Saturday the 7th to Monday the 9th.
    expect((await moveTrip(db, shop.id, trip.id, morning(12, 7))).ok).toBe(true);
  });

  // Attacker review: a row holding another shop's hull reads no window, and
  // the guard must not take that for a clear one.
  it("refuses to move a departure whose hull this shop does not own", async () => {
    const { db, shop, trip } = await hullInTheYard();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-out-of-service", timezone: TZ })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const foreign = await createBoat(db, other.id, "Their hull", 12);
    await db.update(trips).set({ boatId: foreign.id }).where(eq(trips.id, trip.id));
    expect(await moveTrip(db, shop.id, trip.id, morning(12, 20))).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-20",
    });
  });

  it("leaves a departure with no boat alone", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Shore day",
      startsAt: morning(12, 3),
      endsAt: morning(12, 3, 12),
      capacity: 10,
    });
    if (!trip) throw new Error("trip missing");
    expect((await moveTrip(db, shop.id, trip.id, morning(12, 11))).ok).toBe(true);
  });
});

describe("duplicateTrip onto a hull in the yard", () => {
  it("refuses the copy and writes no departure", async () => {
    const { db, shop, boat, trip } = await hullInTheYard();
    const copy = await duplicateTripOrRefusal(db, shop.id, trip.id, morning(12, 11));
    expect(copy).toBe(DUPLICATE_BOAT_OUT_OF_SERVICE);
    const onHull = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.boatId, boat.id), isNull(trips.deletedAt)));
    expect(onHull.map((row) => row.id)).toEqual([trip.id]);
  });

  it("refuses a liveaboard copy that is still out on the window's first day", async () => {
    const { db, shop, boat } = await hullInTheYard();
    const trip = await liveaboardOn(boat.id);
    expect(await duplicateTripOrRefusal(db, shop.id, trip.id, morning(12, 8))).toBe(
      DUPLICATE_BOAT_OUT_OF_SERVICE,
    );
  });

  it("copies onto a day outside the window", async () => {
    const { db, shop, trip } = await hullInTheYard();
    const copy = await duplicateTripOrRefusal(db, shop.id, trip.id, morning(12, 17));
    expect(copy).not.toBeNull();
    expect(copy).not.toBe(DUPLICATE_BOAT_OUT_OF_SERVICE);
  });
});

describe("createTripSeries on a hull in the yard", () => {
  function weekly(shopId: string, boatId: string, weekday: number, anchorDate: string) {
    const [year, month, day] = anchorDate.split("-").map(Number) as [number, number, number];
    const start = wallTimeToUtc({ year, month, day, hour: 8, minute: 0 }, TZ);
    return {
      shopId,
      title: "Weekly on Hull B",
      capacity: 10,
      plannedDives: 2,
      frequency: "weekly" as const,
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([weekday]),
      anchorDate,
      endsOn: null,
      timeZone: TZ,
      boatId,
      template: { startsAt: start, endsAt: new Date(start.getTime() + 4 * 3_600_000) },
    };
  }

  it("refuses the whole series when a later week falls in the window, naming that day", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // Wednesdays from 2030-12-04: the second week, the 11th, is in the yard.
    const result = await createTripSeriesOrRefusal(db, weekly(shop.id, boat.id, WED, "2030-12-04"));
    expect(result).toEqual({ refusal: "boat_out_of_service", firstDay: "2030-12-11" });
    const onHull = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.boatId, boat.id), isNull(trips.deletedAt)));
    expect(onHull).toHaveLength(1);
  });

  it("refuses a series of three-day runs whose second run is out in the window, naming its first yard day", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // Mondays from 2030-12-02, Monday to Wednesday: the second run leaves on
    // the 9th, before the yard, and is at sea on the 10th and 11th.
    const input = weekly(shop.id, boat.id, MON, "2030-12-02");
    const start = input.template.startsAt;
    const result = await createTripSeriesOrRefusal(db, {
      ...input,
      template: { startsAt: start, endsAt: new Date(start.getTime() + 57 * 3_600_000) },
    });
    expect(result).toEqual({ refusal: "boat_out_of_service", firstDay: "2030-12-10" });
  });

  it("refuses a series on another shop's hull as a bad form, not a yard day", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-series-hull", timezone: TZ })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const foreign = await createBoat(db, other.id, "Their hull", 12);
    expect(
      await createTripSeriesOrRefusal(db, weekly(shop.id, foreign.id, WED, "2030-12-04")),
    ).toBeNull();
  });

  it("creates a series whose every week misses the window", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // Saturdays: the 7th and the 14th straddle a Tuesday-to-Thursday window.
    const result = await createTripSeriesOrRefusal(db, weekly(shop.id, boat.id, SAT, "2030-12-07"));
    expect(result).not.toBeNull();
    expect(isSeriesBoatOutOfService(result)).toBe(false);
  });

  // Attacker review S6: the nightly roll is the one path that writes weeks
  // with nobody watching, so it is the one a shop would not notice.
  it("leaves a yard week off when the nightly roll reaches it, and puts it back once the window moves", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // The series starts with no window in reach; the yard is booked later.
    await db
      .update(boats)
      .set({ outOfServiceFrom: null, outOfServiceUntil: null, outOfServiceReason: null })
      .where(eq(boats.id, boat.id));
    // Wednesdays from 2030-08-07: the first 120 days stop short of December.
    const series = await createTripSeriesOrRefusal(db, weekly(shop.id, boat.id, WED, "2030-08-07"));
    if (!series || isSeriesBoatOutOfService(series)) throw new Error("series refused");
    const wednesdays = async () =>
      (
        await db
          .select({ startsAt: trips.startsAt })
          .from(trips)
          .where(and(eq(trips.boatId, boat.id), isNull(trips.deletedAt)))
      ).map((row) => row.startsAt.toISOString());
    const onTheEleventh = morning(12, 11).toISOString();
    expect(await wednesdays()).not.toContain(onTheEleventh);
    const september = wallTimeToUtc({ year: 2030, month: 9, day: 1, hour: 8, minute: 0 }, TZ);

    await db
      .update(boats)
      .set({ outOfServiceFrom: "2030-12-10", outOfServiceUntil: "2030-12-12" })
      .where(eq(boats.id, boat.id));
    await rollSeriesForward(db, shop.id, series.series.id, september);
    const rolled = await wednesdays();
    expect(rolled).not.toContain(onTheEleventh);
    // The weeks either side of the yard still roll on.
    expect(rolled).toContain(morning(12, 4).toISOString());
    expect(rolled).toContain(morning(12, 18).toISOString());

    await db
      .update(boats)
      .set({ outOfServiceFrom: "2031-01-10", outOfServiceUntil: "2031-01-12" })
      .where(eq(boats.id, boat.id));
    await rollSeriesForward(db, shop.id, series.series.id, september);
    expect(await wednesdays()).toContain(onTheEleventh);
  });
});

/**
 * **The nightly roll leaves a yard week off and says which** (issue #3948).
 * The roll is the one path that writes weeks with nobody watching, so the
 * week it leaves off is named in what it returns, and the nightly summary
 * counts it. No skip row is written: a skip closes a slot for good, and a
 * yard window that moves must give the week back.
 */
describe("rollSeriesForward on a hull booked into the yard later", () => {
  const morning2031 = (month: number, day: number) =>
    wallTimeToUtc({ year: 2031, month, day, hour: 8, minute: 0 }, TZ);

  async function openEndedOn(weekdays: number[]) {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Hull C", 12);
    const start = wallTimeToUtc({ year: 2030, month: 8, day: 7, hour: 8, minute: 0 }, TZ);
    // Wednesday 2030-08-07: the first 120 days stop short of December.
    const series = await createTripSeriesOrRefusal(db, {
      shopId: shop.id,
      title: "Weekly on Hull C",
      capacity: 10,
      plannedDives: 2,
      frequency: "weekly" as const,
      intervalWeeks: 1,
      weekdays: weekdaySetFrom(weekdays),
      anchorDate: "2030-08-07",
      endsOn: null,
      timeZone: TZ,
      boatId: boat.id,
      template: { startsAt: start, endsAt: new Date(start.getTime() + 4 * 3_600_000) },
    });
    if (!series || isSeriesBoatOutOfService(series)) throw new Error("series refused");
    const yard = (from: string, until: string) =>
      db
        .update(boats)
        .set({ outOfServiceFrom: from, outOfServiceUntil: until, outOfServiceReason: "Survey" })
        .where(eq(boats.id, boat.id));
    const departures = async () =>
      (
        await db
          .select({ startsAt: trips.startsAt })
          .from(trips)
          .where(and(eq(trips.boatId, boat.id), isNull(trips.deletedAt)))
      ).map((row) => row.startsAt.toISOString());
    return { db, shop, seriesId: series.series.id, yard, departures };
  }

  it("leaves off the week five weeks out that is in the yard, and names it", async () => {
    const { db, shop, seriesId, yard, departures } = await openEndedOn([WED]);
    // Booked after the run started: Wednesday 2031-01-08, five weeks past the
    // roll on Wednesday 2030-12-04.
    await yard("2031-01-07", "2031-01-09");
    const rolled = await rollSeriesForward(db, shop.id, seriesId, morning(12, 4, 3));
    expect(rolled?.inTheYard).toEqual(["2031-01-08"]);
    const onHull = await departures();
    expect(onHull).not.toContain(morning2031(1, 8).toISOString());
    expect(onHull).toContain(morning2031(1, 1).toISOString());
    expect(onHull).toContain(morning2031(1, 15).toISOString());
    // A second pass that night writes nothing and still names the same week.
    await expect(rollSeriesForward(db, shop.id, seriesId, morning(12, 4, 4))).resolves.toEqual({
      created: 0,
      inTheYard: ["2031-01-08"],
    });
  });

  it("leaves off only the second departure of a week when only it is in the yard", async () => {
    const { db, shop, seriesId, yard, departures } = await openEndedOn([WED, SAT]);
    // Saturday 2031-01-11 only; that week's Wednesday the 8th sails.
    await yard("2031-01-10", "2031-01-11");
    const rolled = await rollSeriesForward(db, shop.id, seriesId, morning(12, 4, 3));
    expect(rolled?.inTheYard).toEqual(["2031-01-11"]);
    const onHull = await departures();
    expect(onHull).toContain(morning2031(1, 8).toISOString());
    expect(onHull).not.toContain(morning2031(1, 11).toISOString());
    expect(onHull).toContain(morning2031(1, 4).toISOString());
    expect(onHull).toContain(morning2031(1, 18).toISOString());
  });

  it("writes no skip row, so the week returns and is no longer named once the window moves", async () => {
    const { db, shop, seriesId, yard, departures } = await openEndedOn([WED]);
    await yard("2031-01-07", "2031-01-09");
    expect((await rollSeriesForward(db, shop.id, seriesId, morning(12, 4, 3)))?.inTheYard).toEqual([
      "2031-01-08",
    ]);
    // A skip row would close the slot for good; the roll must not write one.
    expect(
      await db.select().from(tripSeriesSkips).where(eq(tripSeriesSkips.seriesId, seriesId)),
    ).toEqual([]);
    // The survey moves to June, past the horizon: the next pass puts the
    // week on and names nothing.
    await yard("2031-06-03", "2031-06-05");
    await expect(rollSeriesForward(db, shop.id, seriesId, morning(12, 5, 3))).resolves.toEqual({
      created: 1,
      inTheYard: [],
    });
    expect(await departures()).toContain(morning2031(1, 8).toISOString());
  });

  it("names nothing for a hull with no yard window", async () => {
    const { db, shop, seriesId } = await openEndedOn([WED]);
    const rolled = await rollSeriesForward(db, shop.id, seriesId, morning(12, 4, 3));
    expect(rolled?.created).toBeGreaterThan(0);
    expect(rolled?.inTheYard).toEqual([]);
  });
});

/**
 * **Reinstating is a door onto the water too** (issue #4027, dock review of
 * #3994). A liveaboard called off for weather, then a storm-repair window set
 * on its hull, must not come back onto the board in the yard.
 */
describe("reinstateTrip onto a hull now in the yard", () => {
  async function calledOff(tripId: string) {
    const { db, shop } = ctx;
    await setTripStatus(db, shop.id, tripId, "cancelled");
  }
  async function statusOf(tripId: string) {
    const [row] = await ctx.db
      .select({ status: trips.status, cancelledAt: trips.cancelledAt })
      .from(trips)
      .where(eq(trips.id, tripId));
    return row;
  }

  it("refuses a departure whose one day is now in the yard, naming the day, and leaves it called off", async () => {
    const { db, shop, boat } = await hullInTheYard();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Morning on Hull B",
      startsAt: morning(12, 13),
      endsAt: morning(12, 13, 12),
      capacity: 10,
      boatId: boat.id,
    });
    if (!trip) throw new Error("trip missing");
    await calledOff(trip.id);
    await db.update(boats).set({ outOfServiceUntil: "2030-12-13" }).where(eq(boats.id, boat.id));
    expect(await reinstateTrip(db, shop.id, trip.id)).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-13",
    });
    expect((await statusOf(trip.id))?.status).toBe("cancelled");
  });

  it("refuses a liveaboard that is still out on the yard's first day", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // Sunday the 8th to Tuesday the 10th: one span, back on the yard's first day.
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Liveaboard on Hull B",
      startsAt: morning(12, 8),
      endsAt: morning(12, 10, 17),
      capacity: 8,
      boatId: boat.id,
    });
    if (!trip) throw new Error("liveaboard missing");
    await calledOff(trip.id);
    expect(await reinstateTrip(db, shop.id, trip.id)).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-10",
    });
  });

  it("refuses a course whose later meeting day is in the yard", async () => {
    const { db, shop, boat } = await hullInTheYard();
    const course = await createTrip(db, {
      shopId: shop.id,
      title: "Two Saturdays on Hull B",
      startsAt: morning(12, 7),
      endsAt: morning(12, 14, 16),
      capacity: 6,
      boatId: boat.id,
      scheduleDays: [
        { dayNumber: 1, startsAt: morning(12, 7), endsAt: morning(12, 7, 16) },
        { dayNumber: 2, startsAt: morning(12, 14), endsAt: morning(12, 14, 16) },
      ],
    });
    if (!course) throw new Error("course missing");
    await calledOff(course.id);
    // The window grows over the second Saturday only.
    await db.update(boats).set({ outOfServiceUntil: "2030-12-14" }).where(eq(boats.id, boat.id));
    expect(await reinstateTrip(db, shop.id, course.id)).toEqual({
      ok: false,
      reason: "boat_out_of_service",
      on: "2030-12-14",
    });
  });

  it("puts back a departure the yard misses, and clears the call-off date", async () => {
    const { db, shop, trip } = await hullInTheYard();
    await calledOff(trip.id);
    const outcome = await reinstateTrip(db, shop.id, trip.id);
    expect(outcome.ok).toBe(true);
    expect(await statusOf(trip.id)).toEqual({ status: "scheduled", cancelledAt: null });
  });

  it("answers a second tap on a departure already back without asking the yard", async () => {
    const { db, shop, boat, trip } = await hullInTheYard();
    await db.update(boats).set({ outOfServiceFrom: "2030-12-03" }).where(eq(boats.id, boat.id));
    const outcome = await reinstateTrip(db, shop.id, trip.id);
    expect(outcome.ok).toBe(true);
    expect((await statusOf(trip.id))?.status).toBe("scheduled");
  });
});

/**
 * **A retired hull takes no new departure** (issue #4027, attacker review of
 * #3994). The builder reads its boats live, but a stale add panel or the
 * pattern's second departure can still post a deleted hull's id.
 */
describe("a soft-deleted hull", () => {
  it("is refused for a single add", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Retired hull", 12);
    await deleteBoat(db, shop.id, boat.id);
    expect(
      await createTrip(db, {
        shopId: shop.id,
        title: "On a retired hull",
        startsAt: morning(12, 20),
        endsAt: morning(12, 20, 12),
        capacity: 10,
        boatId: boat.id,
      }),
    ).toBeNull();
  });

  it("is refused for a series", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Retired hull", 12);
    await deleteBoat(db, shop.id, boat.id);
    const start = morning(12, 4);
    expect(
      await createTripSeriesOrRefusal(db, {
        shopId: shop.id,
        title: "Weekly on a retired hull",
        capacity: 10,
        plannedDives: 2,
        frequency: "weekly" as const,
        intervalWeeks: 1,
        weekdays: weekdaySetFrom([WED]),
        anchorDate: "2030-12-04",
        endsOn: null,
        timeZone: TZ,
        boatId: boat.id,
        template: { startsAt: start, endsAt: new Date(start.getTime() + 4 * 3_600_000) },
      }),
    ).toBeNull();
  });
});
