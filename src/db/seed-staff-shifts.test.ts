import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { crewShiftCoverage } from "../features/staffing/store";
import { tripAssignments, trips } from "./schema";
import { DEMO_COMPLETED_TRIP_TITLE } from "./seed-more-trips";

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
