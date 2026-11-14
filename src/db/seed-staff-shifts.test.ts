import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { crewShiftCoverage } from "../features/staffing/store";
import { tripAssignments, trips } from "./schema";
import { resetDemoSchedule } from "./seed";
import { withDemoCrewEvidence } from "./seed-crew-evidence";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";
import { seedStaffRoster } from "./seed-staff-roster";

/**
 * **The demo's own crew are on shift for the boats it puts them on**
 * (dive-domain review of the demo layer). The captain, divemaster and
 * assistant crew the 5:30 AM first-light boat, but the one shift every member
 * of the cast worked started an hour before today's departure, never before
 * 8:00, so the trip's crew section warned "Not on a shift" over the demo's
 * own captain.
 */
describe("seeded staff shifts", () => {
  it("cover every crew member of the dawn boat", async () => {
    const { db, shop } = await seededShopContext();
    const [dawn] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, DEMO_COMPLETED_TRIP_TITLE)));
    if (!dawn) throw new Error("the demo has no dawn boat");
    const crew = (
      await db
        .select({ personId: tripAssignments.personId })
        .from(tripAssignments)
        .where(eq(tripAssignments.tripId, dawn.id))
    ).map((row) => row.personId);
    expect(crew.length).toBeGreaterThanOrEqual(2);
    const covered = await crewShiftCoverage(db, shop.id, dawn, crew);
    expect(covered && [...covered].sort()).toEqual([...crew].sort());
  });
});

it("gives every assigned meeting full shift coverage and no seeded day-off conflict", async () => {
  const { db, shop } = await seededShopContext();
  const { staffShifts, tripScheduleDays, crewAvailabilityBlocks } = await import("./schema");
  const { calendarDateInTimezone } = await import("@/lib/calendar-date");
  const crew = await db
    .select({
      personId: tripAssignments.personId,
      tripId: trips.id,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .where(eq(trips.shopId, shop.id));
  const shifts = await db.select().from(staffShifts).where(eq(staffShifts.shopId, shop.id));
  const days = await db.select().from(tripScheduleDays);
  const away = await db
    .select()
    .from(crewAvailabilityBlocks)
    .where(eq(crewAvailabilityBlocks.shopId, shop.id));
  expect(away.length).toBeGreaterThan(5);
  expect(
    new Set(shifts.map((shift) => calendarDateInTimezone(shift.startsAt, shop.timezone))).size,
  ).toBeGreaterThanOrEqual(10);
  for (const assignment of crew) {
    const meetings = days.filter((day) => day.tripId === assignment.tripId);
    for (const meeting of meetings.length ? meetings : [assignment]) {
      expect(
        shifts.some(
          (shift) =>
            shift.personId === assignment.personId &&
            shift.startsAt <= meeting.startsAt &&
            shift.endsAt >= meeting.endsAt,
        ),
        assignment.tripId,
      ).toBe(true);
      const day = calendarDateInTimezone(meeting.startsAt, shop.timezone);
      expect(
        away.some(
          (block) =>
            block.personId === assignment.personId && block.startsOn <= day && block.endsOn >= day,
        ),
        assignment.tripId,
      ).toBe(false);
    }
  }
});

it("keeps the instructor's away-day scenario on the third day without a shift", async () => {
  const { db, shop } = await seededShopContext();
  const { crewAvailabilityBlocks, people, staffShifts } = await import("./schema");
  const { calendarDateInTimezone } = await import("@/lib/calendar-date");
  const { at } = await import("./seed-clock");
  const { LEAD_INSTRUCTOR_NAME } = await import("./seed-cast");
  const [instructor] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, LEAD_INSTRUCTOR_NAME)));
  if (!instructor) throw new Error("instructor missing");
  const date = calendarDateInTimezone(at(3, 8), shop.timezone);
  const blocks = await db
    .select()
    .from(crewAvailabilityBlocks)
    .where(
      and(
        eq(crewAvailabilityBlocks.shopId, shop.id),
        eq(crewAvailabilityBlocks.personId, instructor.id),
      ),
    );
  expect(blocks.some((block) => block.startsOn <= date && block.endsOn >= date)).toBe(true);
  const shifts = await db
    .select()
    .from(staffShifts)
    .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, instructor.id)));
  expect(shifts.some((shift) => shift.startsAt <= at(3, 12) && shift.endsAt > at(3, 12))).toBe(
    false,
  );
});

it("has a distinctive dawn shift this week that is absent next week", async () => {
  const { db, shop } = await seededShopContext();
  const { staffShifts } = await import("./schema");
  const { at } = await import("./seed-clock");
  const shifts = await db
    .select()
    .from(staffShifts)
    .where(
      and(
        eq(staffShifts.shopId, shop.id),
        gte(staffShifts.startsAt, at(0, 0)),
        lt(staffShifts.startsAt, at(13, 0)),
      ),
    );
  const sameTime = (shift: (typeof shifts)[number], offset: number) =>
    shift.startsAt.getTime() === at(offset, 5).getTime() &&
    shift.endsAt.getTime() === at(offset, 9).getTime();
  expect(shifts.some((shift) => sameTime(shift, 0))).toBe(true);
  expect(
    shifts.some((shift) =>
      Array.from({ length: 7 }, (_, index) => index + 6).some((offset) => sameTime(shift, offset)),
    ),
  ).toBe(false);
});

it("leaves early-morning room to add a separate fixture shift on each target week", async () => {
  const { db, shop } = await seededShopContext();
  const { people } = await import("./schema");
  const { at } = await import("./seed-clock");
  const { createStaffShift } = await import("@/features/staffing/store");
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Keiko Tanaka")));
  if (!person) throw new Error("staff missing");
  for (const offset of [2, 6]) {
    expect(
      await createStaffShift(db, {
        shopId: shop.id,
        personId: person.id,
        startsAt: at(offset, 1),
        endsAt: at(offset, 1, 30),
      }),
    ).toMatchObject({ ok: true });
  }
});

it("seeds known fictional credential evidence on live crew boardings, not offline ones", async () => {
  const { db, shop } = await seededShopContext();
  const { rollCallEvents } = await import("./schema");
  const { crewMarks } = await import("./roll-call-subject");
  const rows = await db
    .select()
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shop.id), crewMarks()));
  const boarded = rows.filter(
    (row) =>
      (row.statementStatus ?? row.status) === "boarded" &&
      row.checkpoint === "departure" &&
      row.source === "live",
  );
  expect(boarded.length).toBeGreaterThan(0);
  for (const row of boarded) {
    expect(row.credentialSnapshot?.length).toBeGreaterThan(0);
    expect(row.credentialSnapshotCapturedAt).toEqual(row.occurredAt);
  }
  for (const row of rows.filter((row) => row.source === "offline"))
    expect(row.credentialSnapshot).toBeNull();
});

it("adds fictional credentials only to explicitly authored live departure fixtures", async () => {
  const { db, shop } = await seededShopContext();
  const { rollCallEvents } = await import("./schema");
  const { crewMarks } = await import("./roll-call-subject");
  const [prior] = await db
    .select()
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shop.id), crewMarks()))
    .limit(1);
  if (!prior?.crewPersonId) throw new Error("seeded crew missing");
  const base = {
    shopId: shop.id,
    tripId: prior.tripId,
    subjectKind: "crew" as const,
    crewPersonId: prior.crewPersonId,
    recordedByPersonId: prior.crewPersonId,
    status: "boarded" as const,
    checkpoint: "departure",
    source: "live" as const,
    occurredAt: prior.occurredAt,
  };
  const unknown = "00000000-0000-4000-8000-000000000001";
  const values = await withDemoCrewEvidence(db, shop.id, [
    base,
    { ...base, source: "offline" },
    { ...base, checkpoint: "after_dive_1" },
    { ...base, crewPersonId: unknown },
  ]);
  expect(values[0].credentialSnapshot?.length).toBeGreaterThan(0);
  expect(values[0].credentialSnapshotCapturedAt).toEqual(base.occurredAt);
  for (const value of values.slice(1)) expect(value.credentialSnapshot).toBeUndefined();
  await expect(withDemoCrewEvidence(db, shop.id, [{ ...base, shopId: unknown }])).rejects.toThrow(
    "Mixed demo shops",
  );
});

it("does not rewrite pre-existing live boarding evidence when seeding the staff rota", async () => {
  const { db, shop } = await seededShopContext();
  const { rollCallEvents } = await import("./schema");
  const { crewMarks } = await import("./roll-call-subject");
  const [prior] = await db
    .select()
    .from(rollCallEvents)
    .where(and(eq(rollCallEvents.shopId, shop.id), crewMarks()))
    .limit(1);
  if (!prior?.crewPersonId) throw new Error("seeded crew evidence missing");
  const [authored] = await seedRollCallEvidence(
    db,
    {
      shopId: shop.id,
      tripId: prior.tripId,
      subjectKind: "crew",
      crewPersonId: prior.crewPersonId,
      recordedByPersonId: prior.crewPersonId,
      status: "boarded",
      checkpoint: "departure",
      source: "live",
      occurredAt: prior.occurredAt,
    },
    { observesPrevious: false },
  );
  expect(authored.credentialSnapshot).toBeNull();
  await seedStaffRoster(db, shop.id);
  const [after] = await db.select().from(rollCallEvents).where(eq(rollCallEvents.id, authored.id));
  expect(after.credentialSnapshot).toBeNull();
  expect(after.credentialSnapshotStartedAt).toBeNull();
  expect(after.credentialSnapshotCapturedAt).toBeNull();
});

it("preserves staff-entered shifts across a demo schedule reset", async () => {
  const { db, shop } = await seededShopContext();
  const { staffShifts } = await import("./schema");
  const [existing] = await db
    .select()
    .from(staffShifts)
    .where(eq(staffShifts.shopId, shop.id))
    .limit(1);
  if (!existing) throw new Error("seeded shift missing");
  await db
    .update(staffShifts)
    .set({ note: "Staff-entered edit" })
    .where(eq(staffShifts.id, existing.id));
  const [before] = await db.select().from(staffShifts).where(eq(staffShifts.id, existing.id));
  await resetDemoSchedule(db, shop.id, "lean");
  const [after] = await db.select().from(staffShifts).where(eq(staffShifts.id, existing.id));
  expect(after).toEqual(before);
});

it("does not assign a weekly boat outside the shifts retained at reset", async () => {
  const { db, shop } = await seededShopContext({ history: true });
  const { staffShifts, tripSeries } = await import("./schema");
  const { DEMO_WEEKLY_RUN_TITLE } = await import("./seed-weekly-run");
  const [existing] = await db
    .select()
    .from(staffShifts)
    .where(eq(staffShifts.shopId, shop.id))
    .limit(1);
  if (!existing) throw new Error("seeded shift missing");
  await db
    .delete(staffShifts)
    .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, existing.personId)));
  await resetDemoSchedule(db, shop.id, "history");
  expect(
    await db
      .select()
      .from(staffShifts)
      .where(and(eq(staffShifts.shopId, shop.id), eq(staffShifts.personId, existing.personId))),
  ).toEqual([]);
  const weekly = await db
    .select({ trip: trips, personId: tripAssignments.personId })
    .from(trips)
    .innerJoin(tripSeries, eq(tripSeries.id, trips.seriesId))
    .innerJoin(tripAssignments, eq(tripAssignments.tripId, trips.id))
    .where(
      and(
        eq(trips.shopId, shop.id),
        isNull(trips.deletedAt),
        eq(tripSeries.title, DEMO_WEEKLY_RUN_TITLE),
      ),
    );
  expect(weekly.length).toBeGreaterThan(0);
  for (const { trip, personId } of weekly) {
    expect((await crewShiftCoverage(db, shop.id, trip, [personId]))?.has(personId)).toBe(true);
  }
});

it("does not oversell a reset weekly boat when a standing guide has been deleted", async () => {
  const { db, shop } = await seededShopContext({ history: true });
  const { people, tripSeries, tripSeriesCrew } = await import("./schema");
  const { DEMO_WEEKLY_RUN_TITLE } = await import("./seed-weekly-run");
  const { nowDate } = await import("@/lib/clock");
  const [guide] = await db
    .select({ personId: tripSeriesCrew.personId })
    .from(tripSeriesCrew)
    .innerJoin(tripSeries, eq(tripSeries.id, tripSeriesCrew.seriesId))
    .where(
      and(
        eq(tripSeries.shopId, shop.id),
        eq(tripSeries.title, DEMO_WEEKLY_RUN_TITLE),
        eq(tripSeriesCrew.tripRole, "divemaster"),
      ),
    )
    .limit(1);
  if (!guide) throw new Error("standing guide missing");
  await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, guide.personId));
  await resetDemoSchedule(db, shop.id, "history");
  const weekly = await db
    .select({ trip: trips })
    .from(trips)
    .innerJoin(tripSeries, eq(tripSeries.id, trips.seriesId))
    .where(
      and(
        eq(trips.shopId, shop.id),
        isNull(trips.deletedAt),
        eq(tripSeries.title, DEMO_WEEKLY_RUN_TITLE),
      ),
    );
  expect(weekly.length).toBeGreaterThan(0);
  for (const { trip } of weekly) {
    const crew = await db.select().from(tripAssignments).where(eq(tripAssignments.tripId, trip.id));
    expect(crew.some((member) => member.personId === guide.personId)).toBe(false);
    expect(trip.capacity).toBeLessThanOrEqual(
      crew.filter((member) => member.tripRole === "divemaster").length *
        (shop.diversPerDivemaster ?? 6),
    );
  }
});

it("shows known credential history for the demo's completed crew sailings", async () => {
  const { db, shop } = await seededShopContext();
  const { getSafetyMonth } = await import("@/features/safety-report/store");
  const { nowDate } = await import("@/lib/clock");
  const now = nowDate();
  const report = await getSafetyMonth(
    db,
    shop.id,
    new Date(now.getTime() - 35 * 86400_000),
    now,
    shop.timezone,
    now,
  );
  expect(report.crewSailings).toBeGreaterThan(0);
  expect(report.unknownCredentialSailings).toBe(0);
});
