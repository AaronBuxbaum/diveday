import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { weekdaySetFrom } from "@/lib/recurrence";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { upsertExecutedDive } from "./executed-dives";
import { courses, people, trips } from "./schema";
import { updateTrip } from "./trips-record";
import { applyDetailsToFutureSeries, createTripSeries } from "./trips-series";

/** The database boundary, on the same engine used by the real-Postgres CI job. */
describePostgres("five-dive course constraint", () => {
  it("accepts five for a course and rejects ordinary five and course six", async () => {
    const { db } = await postgresTestDb();
    const shop = await raceShop(db);
    const [course] = await db
      .insert(courses)
      .values({ shopId: shop.id, title: "Course", slug: "course" })
      .returning();
    if (!course) throw new Error("course missing");
    const base = {
      shopId: shop.id,
      title: "Weekend",
      startsAt: new Date("2030-07-13T12:00:00Z"),
      endsAt: new Date("2030-07-14T20:00:00Z"),
      capacity: 6,
    };
    const [accepted] = await db
      .insert(trips)
      .values({ ...base, courseId: course.id, plannedDives: 5 })
      .returning();
    expect(accepted?.plannedDives).toBe(5);
    for (const invalid of [
      { courseId: null, plannedDives: 5 },
      { courseId: course.id, plannedDives: 6 },
    ]) {
      await expect(db.insert(trips).values({ ...base, ...invalid })).rejects.toThrow();
    }
  });
  it("serializes recording dive five against shrinking the plan", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const [course] = await pg.db
      .insert(courses)
      .values({ shopId: shop.id, title: "Course", slug: "course" })
      .returning();
    const [recorder] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Recorder" })
      .returning();
    if (!course || !recorder) throw new Error("course or recorder missing");
    const base = {
      shopId: shop.id,
      title: "Weekend",
      startsAt: new Date("2030-07-13T12:00:00Z"),
      endsAt: new Date("2030-07-14T20:00:00Z"),
      capacity: 6,
    };
    const [trip] = await pg.db
      .insert(trips)
      .values({ ...base, courseId: course.id, plannedDives: 5 })
      .returning();
    if (!trip) throw new Error("trip missing");
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const shrink = updateTrip(pg.connect(), shop.id, trip.id, { ...base, plannedDives: 4 });
    const record = upsertExecutedDive(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      diveNumber: 5,
      recordedByPersonId: recorder.id,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [shrunk, recorded] = await Promise.all([shrink, record]);
    expect([shrunk.ok, recorded.ok].filter(Boolean)).toHaveLength(1);
    if (shrunk.ok)
      expect(recorded).toMatchObject({ ok: false, reason: "dive_number_out_of_range" });
    else expect(shrunk).toMatchObject({ ok: false, reason: "planned_dives_below_history" });
  });
  it("serializes a series apply against recording a sibling's fifth dive", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const [course] = await pg.db
      .insert(courses)
      .values({ shopId: shop.id, title: "Course", slug: "course" })
      .returning();
    const [recorder] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Recorder" })
      .returning();
    if (!course || !recorder) throw new Error("course or recorder missing");
    const series = await createTripSeries(pg.db, {
      shopId: shop.id,
      courseId: course.id,
      title: "Weekend series",
      capacity: 6,
      plannedDives: 5,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([1]),
      anchorDate: "2030-09-02",
      endsOn: "2030-09-09",
      timeZone: "UTC",
      template: {
        startsAt: new Date("2030-09-02T11:00:00Z"),
        endsAt: new Date("2030-09-02T15:00:00Z"),
      },
    });
    const [source, sibling] = series?.trips ?? [];
    if (!series || !source || !sibling) throw new Error("series missing");
    expect(
      await updateTrip(pg.db, shop.id, source.id, {
        title: source.title,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        capacity: source.capacity,
        plannedDives: 4,
      }),
    ).toMatchObject({ ok: true });
    const gate = await holdRowLock(
      pg,
      sql`select id from trips where id = ${sibling.id} for update`,
    );
    const apply = applyDetailsToFutureSeries(
      pg.connect(),
      shop.id,
      series.series.id,
      source.id,
      new Date("2030-09-09T10:00:00Z"),
    );
    const record = upsertExecutedDive(pg.connect(), {
      shopId: shop.id,
      tripId: sibling.id,
      diveNumber: 5,
      recordedByPersonId: recorder.id,
    });
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    const [applied, recorded] = await Promise.all([apply, record]);
    if (recorded.ok) expect(applied).toEqual({ updated: 0, skipped: 1 });
    else {
      expect(recorded.reason).toBe("dive_number_out_of_range");
      expect(applied).toEqual({ updated: 1, skipped: 0 });
    }
  });
});
