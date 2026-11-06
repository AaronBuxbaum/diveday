import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { countingShopContext } from "@/test/query-count";
import { createBoat } from "./boats";
import { boats, courses, shops, tripSeries, trips } from "./schema";
import {
  createTripSeriesOrRefusal,
  deleteTrip,
  getTripSeriesSummary,
  isSeriesBoatOutOfService,
  rollSeriesForward,
} from "./trips";

/**
 * **The desk can read which yard weeks the nightly roll left off** (issue
 * #3988, Aaron's decision: a read-time line, not a stored skip), and since
 * #4010 which hull, until when, and which weeks are still on the board inside
 * the window. The line is asked of the boat's window and the board as they
 * stand, so a week the window has since released is no longer named.
 */
const ctx = fileScopedShopContext();
const TZ = "America/New_York";
const at = (year: number, month: number, day: number, hour = 8) =>
  wallTimeToUtc({ year, month, day, hour, minute: 0 }, TZ);
const rollNight = at(2030, 12, 4, 3);

async function wednesdayRun(
  options: { withBoat?: boolean; courseId?: string; endsAtHour?: [number, number] } = {},
) {
  const { db, shop } = ctx;
  await db.update(shops).set({ timezone: TZ }).where(eq(shops.id, shop.id));
  const boat = await createBoat(db, shop.id, "Hull Y", 12);
  const [endDay, endHour] = options.endsAtHour ?? [7, 12];
  const made = await createTripSeriesOrRefusal(db, {
    shopId: shop.id,
    title: "Wednesday boat",
    capacity: 10,
    plannedDives: 2,
    frequency: "weekly" as const,
    intervalWeeks: 1,
    weekdays: weekdaySetFrom([3]),
    anchorDate: "2030-08-07",
    endsOn: null,
    timeZone: TZ,
    ...(options.withBoat === false ? {} : { boatId: boat.id }),
    ...(options.courseId ? { courseId: options.courseId } : {}),
    template: { startsAt: at(2030, 8, 7), endsAt: at(2030, 8, endDay, endHour) },
  });
  if (!made || isSeriesBoatOutOfService(made)) throw new Error("series refused");
  const seriesId = made.series.id;
  const [anyTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.seriesId, seriesId), eq(trips.shopId, shop.id)))
    .limit(1);
  if (!anyTrip) throw new Error("no instance");
  return {
    seriesId,
    yard: (from: string | null, until: string | null) =>
      db
        .update(boats)
        .set({ outOfServiceFrom: from, outOfServiceUntil: until, outOfServiceReason: "Survey" })
        .where(eq(boats.id, boat.id)),
    endsOn: (date: string) =>
      db.update(tripSeries).set({ endsOn: date }).where(eq(tripSeries.id, seriesId)),
    roll: () => rollSeriesForward(db, shop.id, seriesId, rollNight),
    tripOn: async (startsAt: Date) => {
      const [row] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.seriesId, seriesId), eq(trips.startsAt, startsAt)));
      return row;
    },
    line: async (reader: typeof db = db) =>
      (await getTripSeriesSummary(reader, shop.id, anyTrip.id, rollNight))?.yardLine,
  };
}

describe("getTripSeriesSummary's yard line", () => {
  it("names the hull, the window's last day, and each cadence date left off the board", async () => {
    const run = await wednesdayRun();
    await run.yard("2031-01-08", "2031-01-22");
    const rolled = await run.roll();
    expect(await run.line()).toEqual({
      boat: "Hull Y",
      from: "2031-01-08",
      until: "2031-01-22",
      leftOff: ["2031-01-08", "2031-01-15", "2031-01-22"],
      onBoard: [],
    });
    // The line and the roll are one answer: the dates the roll reports are the dates named.
    expect(rolled?.inTheYard).toEqual((await run.line())?.leftOff);
  });

  it("goes once the window moves off those weeks: the week returns, nothing was stored", async () => {
    const run = await wednesdayRun();
    await run.yard("2031-01-08", "2031-01-14");
    await run.roll();
    expect((await run.line())?.leftOff).toEqual(["2031-01-08"]);
    await run.yard("2031-02-01", "2031-02-02");
    expect(await run.line()).toBeNull();
    await run.roll();
    expect(await run.tripOn(at(2031, 1, 8))).toBeDefined();
  });

  it("names the weeks already on the board inside the window, never one staff deleted", async () => {
    const run = await wednesdayRun();
    await run.roll();
    const onBoard = await run.tripOn(at(2031, 1, 8));
    if (!onBoard) throw new Error("expected Jan 8 on the board");
    await deleteTrip(ctx.db, ctx.shop.id, onBoard.id);
    await run.yard("2031-01-01", "2031-01-22");
    expect(await run.line()).toEqual({
      boat: "Hull Y",
      from: "2031-01-01",
      until: "2031-01-22",
      leftOff: [],
      onBoard: ["2031-01-01", "2031-01-15", "2031-01-22"],
    });
  });

  it("is null for a series on no boat, and for a boat with no window", async () => {
    const noBoat = await wednesdayRun({ withBoat: false });
    expect(await noBoat.line()).toBeNull();
    const clear = await wednesdayRun();
    expect(await clear.line()).toBeNull();
  });

  it("is null for a series that ended before the window", async () => {
    const run = await wednesdayRun();
    await run.yard("2031-01-08", "2031-01-14");
    await run.endsOn("2030-10-01");
    expect(await run.line()).toBeNull();
  });

  // The roll fails for a series whose course is archived, so it leaves no
  // week off for the yard: the line names none, but still names the weeks on
  // the board that would sail into the yard.
  it("names no week left off for an archived course, only the weeks still on the board", async () => {
    const [course] = await ctx.db
      .insert(courses)
      .values({
        shopId: ctx.shop.id,
        title: "Advanced",
        slug: `yard-line-advanced-${Date.UTC(2030, 0, 1)}`,
        agency: "PADI",
        certifiesLevel: "advanced_open_water",
      })
      .returning();
    if (!course) throw new Error("course missing");
    const run = await wednesdayRun({ courseId: course.id });
    await run.yard("2031-01-08", "2031-01-14");
    expect((await run.line())?.leftOff).toEqual(["2031-01-08"]);
    await ctx.db.update(courses).set({ isActive: false }).where(eq(courses.id, course.id));
    expect(await run.line()).toBeNull();
    await run.yard("2030-12-04", "2030-12-04");
    expect(await run.line()).toMatchObject({ leftOff: [], onBoard: ["2030-12-04"] });
  });

  it("asks every day a multi-day template holds the hull, not only the day it leaves", async () => {
    // Wednesday 08:00 to Friday 12:00, one span with no named days.
    const run = await wednesdayRun({ endsAtHour: [9, 12] });
    await run.yard("2031-01-10", "2031-01-10");
    expect((await run.line())?.leftOff).toEqual(["2031-01-08"]);
  });
});

describe("the yard line's reads", () => {
  it("reads only the cadence slots inside the roll's horizon, not every instance the run ever had", async () => {
    const log = await countingShopContext();
    const db = log.uncounted;
    const boat = await createBoat(db, log.shop.id, "Hull Y", 12);
    const made = await createTripSeriesOrRefusal(db, {
      shopId: log.shop.id,
      title: "Wednesday boat",
      capacity: 10,
      plannedDives: 2,
      frequency: "weekly" as const,
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([3]),
      anchorDate: "2030-08-07",
      endsOn: null,
      timeZone: TZ,
      boatId: boat.id,
      template: { startsAt: at(2030, 8, 7), endsAt: at(2030, 8, 7, 12) },
    });
    if (!made || isSeriesBoatOutOfService(made)) throw new Error("series refused");
    const first = made.trips[0];
    if (!first) throw new Error("no instance");
    await db
      .update(boats)
      .set({ outOfServiceFrom: "2031-01-08", outOfServiceUntil: "2031-01-14" })
      .where(eq(boats.id, boat.id));
    log.reset();
    await getTripSeriesSummary(log.db, log.shop.id, first.id, rollNight);
    // Every statement that asks which cadence slots are taken or skipped.
    const slotReads = log.statements.filter((sql) => /\bwhere\b.*occurrence_date"/is.test(sql));
    expect(slotReads.length).toBeGreaterThan(0);
    for (const sql of slotReads) expect(sql).toMatch(/occurrence_date" >= \$\d+/);
  });
});
