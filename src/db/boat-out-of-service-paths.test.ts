import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { boats, trips } from "./schema";
import {
  createTrip,
  createTripSeriesOrRefusal,
  DUPLICATE_BOAT_OUT_OF_SERVICE,
  duplicateTripOrRefusal,
  moveTrip,
  SERIES_BOAT_OUT_OF_SERVICE,
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
    expect(outcome).toEqual({ ok: false, reason: "boat_out_of_service" });
    expect(await startOf(db, trip.id)).toEqual(trip.startsAt);
  });

  it("reads the day in the shop's zone: 22:00 local on the 9th is the 9th", async () => {
    const { db, shop, trip } = await hullInTheYard();
    // 03:00Z on the 10th, still the evening of the 9th in New York.
    const outcome = await moveTrip(db, shop.id, trip.id, morning(12, 9, 22));
    expect(outcome.ok).toBe(true);
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

  it("refuses the whole series when a later week falls in the window", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // Wednesdays from 2030-12-04: the second week, the 11th, is in the yard.
    const result = await createTripSeriesOrRefusal(db, weekly(shop.id, boat.id, WED, "2030-12-04"));
    expect(result).toBe(SERIES_BOAT_OUT_OF_SERVICE);
    const onHull = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.boatId, boat.id), isNull(trips.deletedAt)));
    expect(onHull).toHaveLength(1);
  });

  it("creates a series whose every week misses the window", async () => {
    const { db, shop, boat } = await hullInTheYard();
    // Saturdays: the 7th and the 14th straddle a Tuesday-to-Thursday window.
    const result = await createTripSeriesOrRefusal(db, weekly(shop.id, boat.id, SAT, "2030-12-07"));
    expect(result).not.toBeNull();
    expect(result).not.toBe(SERIES_BOAT_OUT_OF_SERVICE);
  });
});
