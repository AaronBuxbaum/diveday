import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { weekdaySetFrom } from "@/lib/recurrence";
import { fileScopedShopContext } from "@/test/db";
import { listExecutedDives, upsertExecutedDive } from "./executed-dives";
import { getTripManifest, recordRollCall } from "./manifests";
import { bookings, courses, people, tripDives, trips } from "./schema";
import { listStaff } from "./trips";
import { createTrip, normalizedDiveCount } from "./trips-create";
import { updateTrip } from "./trips-record";
import { applyDetailsToFutureSeries, createTripSeries } from "./trips-series";

const ctx = fileScopedShopContext();
const tripDetails = {
  title: "Advanced course weekend",
  startsAt: new Date("2030-07-13T12:00:00Z"),
  endsAt: new Date("2030-07-14T20:00:00Z"),
  capacity: 6,
};

async function activeCourseId() {
  const { db, shop } = ctx;
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.isActive, true)))
    .limit(1);
  if (!course) throw new Error("seeded course missing");
  return course.id;
}

describe("five-dive course sessions", () => {
  it("accepts five only for a course when validating the planned count", () => {
    expect(normalizedDiveCount(4)).toBe(4);
    expect(normalizedDiveCount(5)).toBeNull();
    expect(normalizedDiveCount(5, true)).toBe(5);
    expect(normalizedDiveCount(6, true)).toBeNull();
    expect(normalizedDiveCount(1.5, true)).toBeNull();
  });

  it("creates a course session with all five planned dive records", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      ...tripDetails,
      shopId: shop.id,
      courseId: await activeCourseId(),
      plannedDives: 5,
    });
    expect(trip).not.toBeNull();
    if (!trip) throw new Error("course session not created");
    expect(trip.plannedDives).toBe(5);
    const dives = await db
      .select({ number: tripDives.diveNumber })
      .from(tripDives)
      .where(eq(tripDives.tripId, trip.id))
      .orderBy(tripDives.diveNumber);
    expect(dives.map(({ number }) => number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts a five-dive course at the database boundary", async () => {
    const { db, shop } = ctx;
    const [trip] = await db
      .insert(trips)
      .values({
        ...tripDetails,
        shopId: shop.id,
        courseId: await activeCourseId(),
        plannedDives: 5,
      })
      .returning();
    expect(trip?.plannedDives).toBe(5);
  });

  it("records dive five and reconciles its offline head count once", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      ...tripDetails,
      shopId: shop.id,
      courseId: await activeCourseId(),
      plannedDives: 5,
    });
    if (!trip) throw new Error("course session not created");
    const [staff] = await listStaff(db, shop.id);
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Five Dive Student" })
      .returning();
    if (!staff || !person) throw new Error("staff or student missing");
    const [booking] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: person.id,
        bookedAs: "diver",
      })
      .returning();
    if (!booking) throw new Error("booking missing");
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 5,
        maxDepthMeters: 18,
        recordedByPersonId: staff.person.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await listExecutedDives(db, shop.id, trip.id)).map((row) => row.executed.diveNumber),
    ).toEqual([5]);
    const event = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      checkpoint: "after_dive_5" as const,
      status: "not_boarded" as const,
      source: "offline" as const,
      clientEventId: "8d9769b0-f865-44a6-83e9-5534c355a47d",
      occurredAt: nowDate(),
      offlineSnapshotSavedAt: nowDate(),
    };
    expect(await recordRollCall(db, event)).toMatchObject({ ok: true });
    expect(await recordRollCall(db, event)).toMatchObject({ ok: true, duplicate: true });
    const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_5");
    expect(manifest?.divers.find((entry) => entry.bookingId === booking.id)?.rollCall?.state).toBe(
      "not_boarded",
    );
  });

  it("never removes the fifth checkpoint after dive five was logged", async () => {
    const { db, shop } = ctx;
    const trip = await createTrip(db, {
      ...tripDetails,
      shopId: shop.id,
      courseId: await activeCourseId(),
      plannedDives: 5,
    });
    const [staff] = await listStaff(db, shop.id);
    if (!trip || !staff) throw new Error("course or recorder missing");
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: trip.id,
        diveNumber: 5,
        recordedByPersonId: staff.person.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await updateTrip(db, shop.id, trip.id, { ...tripDetails, plannedDives: 4 }),
    ).toMatchObject({
      ok: false,
      reason: "planned_dives_below_history",
      detail: { recordedDiveCount: 5 },
    });
  });

  it("never applies a shorter plan over a future sibling with a logged fifth dive", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const series = await createTripSeries(db, {
      shopId: shop.id,
      courseId: await activeCourseId(),
      title: "Weekend series",
      capacity: 6,
      plannedDives: 5,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: weekdaySetFrom([1]),
      anchorDate: "2030-09-02",
      endsOn: "2030-09-09",
      timeZone: "America/New_York",
      template: {
        startsAt: new Date("2030-09-02T11:00:00Z"),
        endsAt: new Date("2030-09-02T15:00:00Z"),
      },
    });
    const [source, sibling] = series?.trips ?? [];
    if (!series || !source || !sibling || !staff) throw new Error("series or recorder missing");
    expect(
      await upsertExecutedDive(db, {
        shopId: shop.id,
        tripId: sibling.id,
        diveNumber: 5,
        recordedByPersonId: staff.person.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await updateTrip(db, shop.id, source.id, {
        title: source.title,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        capacity: source.capacity,
        plannedDives: 4,
      }),
    ).toMatchObject({ ok: true });
    const now = new Date("2030-09-09T10:00:00Z");
    expect(now.getTime()).toBeLessThan(sibling.startsAt.getTime());
    expect(await applyDetailsToFutureSeries(db, shop.id, series.series.id, source.id, now)).toEqual(
      { updated: 0, skipped: 1 },
    );
  });

  it("keeps a five-dive plan unavailable to a non-course departure", async () => {
    const { db, shop } = ctx;
    expect(await createTrip(db, { ...tripDetails, shopId: shop.id, plannedDives: 5 })).toBeNull();
  });

  it("rejects six planned dives for a course and five for a regular trip at the database boundary", async () => {
    const { db, shop } = ctx;
    const courseId = await activeCourseId();
    for (const invalid of [
      { courseId, plannedDives: 6 },
      { courseId: null, plannedDives: 5 },
    ]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.insert(trips).values({ ...tripDetails, shopId: shop.id, ...invalid });
        }),
      ).rejects.toThrow();
    }
  });
});
