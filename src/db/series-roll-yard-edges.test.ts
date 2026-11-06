import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { CalendarDate } from "@/lib/calendar-date";
import { weekdaySetFrom } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { boats, shops, trips } from "./schema";
import { createTripSeriesOrRefusal, isSeriesBoatOutOfService, rollSeriesForward } from "./trips";

/**
 * **The nightly roll reads the yard window by the shop's calendar, both ends
 * inclusive, on every meeting day** (issue #3948). The roll is the one path
 * that puts departures on a hull with nobody watching, so its edges are pinned
 * here directly: the day the window opens, the day it closes, a weekend's
 * second meeting day, and a departure whose UTC date is another day than the
 * shop's, west of UTC and east of it.
 * Each series starts with no window in reach; the yard is booked afterwards,
 * and the roll on Wednesday 2030-12-04 reaches into January 2031.
 */
const ctx = fileScopedShopContext();
const TZ = "America/New_York";
const WED = 3;
const SAT = 6;
const at = (year: number, month: number, day: number, hour = 8, minute = 0) =>
  wallTimeToUtc({ year, month, day, hour, minute }, TZ);
const rollNight = at(2030, 12, 4, 3);

type Leg = { startsAt: Date; endsAt: Date };

async function seriesOnHull(input: {
  weekday: number;
  anchorDate: CalendarDate;
  legs: [Leg, ...Leg[]];
  timeZone?: string;
}) {
  const { db, shop } = ctx;
  const timeZone = input.timeZone ?? TZ;
  // The roll reads the shop's zone; the test's transaction rolls this back.
  await db.update(shops).set({ timezone: timeZone }).where(eq(shops.id, shop.id));
  const boat = await createBoat(db, shop.id, "Hull Y", 12);
  const [first] = input.legs;
  const last = input.legs.at(-1) ?? first;
  const series = await createTripSeriesOrRefusal(db, {
    shopId: shop.id,
    title: "Standing departure on Hull Y",
    capacity: 10,
    plannedDives: 2,
    frequency: "weekly" as const,
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([input.weekday]),
    anchorDate: input.anchorDate,
    endsOn: null,
    timeZone,
    boatId: boat.id,
    template: {
      startsAt: first.startsAt,
      endsAt: last.endsAt,
      ...(input.legs.length > 1
        ? { scheduleDays: input.legs.map((leg, index) => ({ dayNumber: index + 1, ...leg })) }
        : {}),
    },
  });
  if (!series || isSeriesBoatOutOfService(series)) throw new Error("series refused");
  const yard = (from: CalendarDate, until: CalendarDate) =>
    db
      .update(boats)
      .set({ outOfServiceFrom: from, outOfServiceUntil: until, outOfServiceReason: "Survey" })
      .where(eq(boats.id, boat.id));
  const roll = () => rollSeriesForward(db, shop.id, series.series.id, rollNight);
  const departures = async () =>
    (
      await db
        .select({ startsAt: trips.startsAt })
        .from(trips)
        .where(and(eq(trips.boatId, boat.id), isNull(trips.deletedAt)))
    ).map((row) => row.startsAt.toISOString());
  return { yard, roll, departures };
}

const wednesdayMornings = () =>
  seriesOnHull({
    weekday: WED,
    anchorDate: "2030-08-07",
    legs: [{ startsAt: at(2030, 8, 7), endsAt: at(2030, 8, 7, 12) }],
  });

// 20:30 on a Wednesday in New York is 01:30 Thursday in UTC.
const wednesdayNights = () =>
  seriesOnHull({
    weekday: WED,
    anchorDate: "2030-08-07",
    legs: [{ startsAt: at(2030, 8, 7, 20, 30), endsAt: at(2030, 8, 7, 22, 30) }],
  });

describe("rollSeriesForward at the edges of a yard window", () => {
  it("leaves off the departure on the day the window opens, and sails the day after it closes", async () => {
    const { yard, roll, departures } = await wednesdayMornings();
    await yard("2031-01-08", "2031-01-14");
    await roll();
    const onHull = await departures();
    expect(onHull).toContain(at(2031, 1, 1).toISOString());
    expect(onHull).not.toContain(at(2031, 1, 8).toISOString());
    expect(onHull).toContain(at(2031, 1, 15).toISOString());
  });

  it("leaves off the departure on the day the window closes, and sails the day before it opens", async () => {
    const { yard, roll, departures } = await wednesdayMornings();
    await yard("2031-01-02", "2031-01-08");
    await roll();
    const onHull = await departures();
    expect(onHull).toContain(at(2031, 1, 1).toISOString());
    expect(onHull).not.toContain(at(2031, 1, 8).toISOString());
    expect(onHull).toContain(at(2031, 1, 15).toISOString());
  });

  it("leaves a whole weekend off when only its second meeting day is in the yard", async () => {
    const { yard, roll, departures } = await seriesOnHull({
      weekday: SAT,
      anchorDate: "2030-08-10",
      legs: [
        { startsAt: at(2030, 8, 10), endsAt: at(2030, 8, 10, 12) },
        { startsAt: at(2030, 8, 11), endsAt: at(2030, 8, 11, 12) },
      ],
    });
    // Sunday 2031-01-12 only: that weekend's Saturday is clear, but the
    // course comes back to the hull the next morning.
    await yard("2031-01-12", "2031-01-12");
    await roll();
    const onHull = await departures();
    expect(onHull).toContain(at(2031, 1, 4).toISOString());
    expect(onHull).not.toContain(at(2031, 1, 11).toISOString());
    expect(onHull).toContain(at(2031, 1, 18).toISOString());
  });

  it("leaves off a night departure on a yard day the server's UTC date would call tomorrow", async () => {
    const { yard, roll, departures } = await wednesdayNights();
    await yard("2031-01-08", "2031-01-08");
    await roll();
    const onHull = await departures();
    expect(onHull).not.toContain(at(2031, 1, 8, 20, 30).toISOString());
    expect(onHull).toContain(at(2031, 1, 15, 20, 30).toISOString());
  });

  it("sails a night departure the day before a yard day its UTC date falls on", async () => {
    const { yard, roll, departures } = await wednesdayNights();
    await yard("2031-01-09", "2031-01-09");
    await roll();
    expect(await departures()).toContain(at(2031, 1, 8, 20, 30).toISOString());
  });

  // East of UTC it is every morning boat, not a night dive: 07:00 Wednesday in
  // Auckland's summer is 18:00 Tuesday in UTC.
  const AKL = "Pacific/Auckland";
  const inAuckland = (month: number, day: number, year = 2031, hour = 7) =>
    wallTimeToUtc({ year, month, day, hour, minute: 0 }, AKL);
  const aucklandMornings = () =>
    seriesOnHull({
      weekday: WED,
      anchorDate: "2030-08-07",
      timeZone: AKL,
      legs: [{ startsAt: inAuckland(8, 7, 2030), endsAt: inAuckland(8, 7, 2030, 11) }],
    });

  it("leaves off a morning boat east of UTC on its own yard day", async () => {
    const { yard, roll, departures } = await aucklandMornings();
    await yard("2031-01-08", "2031-01-08");
    await roll();
    const onHull = await departures();
    expect(onHull).not.toContain(inAuckland(1, 8).toISOString());
    expect(onHull).toContain(inAuckland(1, 15).toISOString());
  });

  it("sails a morning boat east of UTC when only its UTC date is a yard day", async () => {
    const { yard, roll, departures } = await aucklandMornings();
    await yard("2031-01-07", "2031-01-07");
    await roll();
    expect(await departures()).toContain(inAuckland(1, 8).toISOString());
  });
});
