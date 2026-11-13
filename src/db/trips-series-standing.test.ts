import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { addCalendarDays, utcToWallTime, wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext, type seededShopContext } from "@/test/db";
import { courses, staffShifts, trips } from "./schema";
import {
  createTrip,
  createTripSeries,
  getSeriesStandingCrew,
  getTripCrewAssignments,
  listStaff,
  type NewTripSeries,
  rollSeriesForward,
  setSeriesStandingCrew,
  setTripCrew,
  setTripStatus,
} from "./trips";

const TZ = "America/New_York";
const SAT = 6;
const at = (iso: string) => new Date(iso);
const ctx = fileScopedShopContext();
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

describe("a run's standing crew (2026-10-12): applied per date, never assumed", () => {
  // These propagation/clash tests require on-shift crew. Explicit Saturday
  // shifts cover every date this fixture's rolls can materialize; the separate
  // crew-shift-scheduling suite proves missing/partial shifts are refused.
  beforeEach(async () => {
    const { db, shop } = ctx;
    const staff = await listStaff(db, shop.id);
    const first = utcToWallTime(at("2030-09-07T12:00:00Z"), TZ);
    const shifts = Array.from({ length: 40 }, (_, week) => addCalendarDays(first, week * 7));
    await db.insert(staffShifts).values(
      staff.flatMap(({ person }) =>
        shifts.map((day) => ({
          shopId: shop.id,
          personId: person.id,
          startsAt: wallTimeToUtc({ ...day, hour: 6, minute: 0 }, TZ),
          endsAt: wallTimeToUtc({ ...day, hour: 18, minute: 0 }, TZ),
        })),
      ),
    );
  });

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
