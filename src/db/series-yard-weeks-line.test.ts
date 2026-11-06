import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { boats, shops, tripSeries, trips } from "./schema";
import {
  createTripSeriesOrRefusal,
  deleteTrip,
  getTripSeriesSummary,
  isSeriesBoatOutOfService,
  rollSeriesForward,
} from "./trips";

/**
 * **The desk can read which yard weeks the nightly roll left off** (issue
 * #3988, Aaron's decision: a read-time line, not a stored skip). The list is
 * asked of the boat's window and the board as they stand, so a week the window
 * has since released is no longer named, and a week already on the board or
 * deleted by staff is never named as left off.
 */
const ctx = fileScopedShopContext();
const TZ = "America/New_York";
const at = (year: number, month: number, day: number, hour = 8) =>
  wallTimeToUtc({ year, month, day, hour, minute: 0 }, TZ);
const rollNight = at(2030, 12, 4, 3);

async function wednesdayRun(withBoat = true) {
  const { db, shop } = ctx;
  await db.update(shops).set({ timezone: TZ }).where(eq(shops.id, shop.id));
  const boat = await createBoat(db, shop.id, "Hull Y", 12);
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
    ...(withBoat ? { boatId: boat.id } : {}),
    template: { startsAt: at(2030, 8, 7), endsAt: at(2030, 8, 7, 12) },
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
    line: async () =>
      (await getTripSeriesSummary(db, shop.id, anyTrip.id, rollNight))?.yardDatesLeftOff,
  };
}

describe("getTripSeriesSummary names the yard weeks the roll leaves off", () => {
  it("lists each cadence date the window touches that is not on the board", async () => {
    const run = await wednesdayRun();
    await run.yard("2031-01-08", "2031-01-22");
    const rolled = await run.roll();
    expect(await run.line()).toEqual(["2031-01-08", "2031-01-15", "2031-01-22"]);
    // The line and the roll are one answer: the dates the roll reports are the dates named.
    expect(rolled?.inTheYard).toEqual(await run.line());
  });

  it("names nothing once the window moves off those weeks: the week returns, nothing was stored", async () => {
    const run = await wednesdayRun();
    await run.yard("2031-01-08", "2031-01-14");
    await run.roll();
    expect(await run.line()).toEqual(["2031-01-08"]);
    await run.yard("2031-02-01", "2031-02-02");
    expect(await run.line()).toEqual([]);
    await run.roll();
    expect(await run.tripOn(at(2031, 1, 8))).toBeDefined();
  });

  it("does not name a week already on the board, or one staff deleted", async () => {
    const run = await wednesdayRun();
    await run.roll();
    const onBoard = await run.tripOn(at(2031, 1, 8));
    if (!onBoard) throw new Error("expected Jan 8 on the board");
    await deleteTrip(ctx.db, ctx.shop.id, onBoard.id);
    await run.yard("2031-01-01", "2031-01-22");
    // Every week was already on the board when the yard was booked, and Jan 8
    // was deleted by staff: none of them is a week the roll left off.
    expect(await run.line()).toEqual([]);
  });

  it("is empty for a series on no boat, and for a boat with no window", async () => {
    const noBoat = await wednesdayRun(false);
    expect(await noBoat.line()).toEqual([]);
    const clear = await wednesdayRun();
    expect(await clear.line()).toEqual([]);
  });

  it("is empty for a series that ended before the window", async () => {
    const run = await wednesdayRun();
    await run.yard("2031-01-08", "2031-01-14");
    await run.endsOn("2030-10-01");
    expect(await run.line()).toEqual([]);
  });
});
