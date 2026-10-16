// @vitest-environment node
import { describe, expect, it } from "vitest";
import { calendarDateWeekday } from "@/lib/calendar-date";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { rollCallCrewEvents, tripStageEvents } from "./schema";
import {
  cancelOffCadenceSeriesTrips,
  createTripSeries,
  getTripWithBooked,
  listOffCadenceSeriesTrips,
  listStaff,
  type NewTripSeries,
  updateSeriesCadence,
} from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

const WED = 3;
const SAT = 6;
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
    timeZone: "America/New_York",
    template: {
      startsAt: at("2030-09-07T11:00:00.000Z"),
      endsAt: at("2030-09-07T15:00:00.000Z"),
    },
    ...overrides,
  };
}

/**
 * **A run's bulk call-off never cancels a boat on the water** (H-122,
 * `departureMayBeAtSea`): narrowing a cadence offers the off-cadence dates,
 * and one the crew have already taken out is neither offered nor cancelled.
 */
describe("cancelOffCadenceSeriesTrips and a boat at sea", () => {
  it("never calls off a date the crew have taken out early; a dock count at the tied-up boat still goes", async () => {
    const { db, shop } = ctx;
    const now = at("2030-09-30T12:00:00.000Z");
    const result = await createTripSeries(
      db,
      seriesInput({ shopId: shop.id, weekdays: weekdaySetFrom([WED, SAT]) }),
    );
    if (!result) throw new Error("series not created");
    const [early, staged, tiedUp] = result.trips.filter(
      (trip) =>
        trip.startsAt >= now &&
        trip.seriesOccurrenceDate &&
        calendarDateWeekday(trip.seriesOccurrenceDate) === WED,
    );
    if (!early || !staged || !tiedUp) throw new Error("expected three future Wednesdays");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed staff missing");
    // Out before its time: an after-dive result on the crew list, and a stage
    // past Boarding with no roll call at all.
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: early.id,
      personId: staff.person.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "after_dive_1",
      occurredAt: now,
    });
    await db.insert(tripStageEvents).values({
      shopId: shop.id,
      tripId: staged.id,
      stage: "underway",
      recordedByPersonId: staff.person.id,
    });
    // Counted aboard at the dock, still tied up.
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: tiedUp.id,
      personId: staff.person.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: now,
    });

    await updateSeriesCadence(
      db,
      shop.id,
      result.series.id,
      { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null },
      now,
    );
    const listed = (await listOffCadenceSeriesTrips(db, shop.id, result.series.id, now)).map(
      (trip) => trip.id,
    );
    expect(listed).not.toContain(early.id);
    expect(listed).not.toContain(staged.id);
    expect(listed).toContain(tiedUp.id);

    await cancelOffCadenceSeriesTrips(db, shop.id, result.series.id, now);
    expect((await getTripWithBooked(db, shop.id, early.id))?.status).toBe("scheduled");
    expect((await getTripWithBooked(db, shop.id, staged.id))?.status).toBe("scheduled");
    expect((await getTripWithBooked(db, shop.id, tiedUp.id))?.status).toBe("cancelled");
  });
});
