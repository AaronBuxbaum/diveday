// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EVERY_WEEKDAY } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import {
  createTripSeries,
  getTripSeriesSummary,
  listStaff,
  setSeriesStandingCrew,
  setTripCrew,
} from "./trips";

const ctx = fileScopedShopContext();

describe("a run's standing crew, named for the series panel", () => {
  it("lists no one before a standing crew is set, then each by name in order", async () => {
    const { db, shop } = ctx;
    const now = new Date("2030-08-15T00:00:00.000Z");
    const created = await createTripSeries(db, {
      shopId: shop.id,
      title: "Saturday Crew Run",
      capacity: 12,
      plannedDives: 2,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: EVERY_WEEKDAY,
      anchorDate: "2030-09-07",
      endsOn: null,
      timeZone: "America/New_York",
      template: {
        startsAt: new Date("2030-09-07T11:00:00.000Z"),
        endsAt: new Date("2030-09-07T15:00:00.000Z"),
      },
    });
    const source = created?.trips[0];
    if (!created || !source) throw new Error("series not created");
    const staff = await listStaff(db, shop.id);
    const [first, second] = staff;
    if (!first || !second) throw new Error("seeded shop needs two staff members");

    const before = await getTripSeriesSummary(db, shop.id, source.id, now);
    expect(before?.standingCrewNames).toEqual([]);
    expect(before?.standingCrew).toBe(false);

    expect(await setTripCrew(db, shop.id, source.id, [first.person.id, second.person.id])).toBe(
      true,
    );
    await setSeriesStandingCrew(db, {
      shopId: shop.id,
      seriesId: created.series.id,
      sourceTripId: source.id,
      standing: true,
      actorPersonId: null,
      now,
    });
    const after = await getTripSeriesSummary(db, shop.id, source.id, now);
    const names = [first.person.fullName, second.person.fullName].sort();
    expect(after?.standingCrewNames).toEqual(names);
    expect(after?.standingCrew).toBe(true);
  });
});
