import { and, asc, count, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { courseCrewGap } from "@/lib/course-ratios";
import type { AppDb } from "./client";
import {
  bookings,
  courses,
  people,
  personRoles,
  staffShifts,
  tripAssignments,
  trips,
} from "./schema";
import { courseCrewCountsByTrip } from "./today";
import { listStaff } from "./trips";
import { liveTrip } from "./trips-live";

export type StaffCapability = "teach" | "crew" | "captain";

export function capabilitiesForRoles(roles: readonly string[]): StaffCapability[] {
  const capabilities: StaffCapability[] = [];
  if (roles.includes("instructor")) capabilities.push("teach");
  if (roles.some((role) => ["instructor", "divemaster", "captain", "crew"].includes(role))) {
    capabilities.push("crew");
  }
  if (roles.includes("captain")) capabilities.push("captain");
  return capabilities;
}

/**
 * How many of the window's departures still need somebody on the crew — a
 * *count*, and deliberately nothing more.
 *
 * The shift roster used to render its own per-departure coverage table, with
 * its own gap vocabulary (`over_ratio` / `course_needs_instructor`) beside
 * Today's word for the same fact (`instructor_missing`). Two surfaces, two
 * names, one computation, and only Today's could actually assign anyone —
 * the roster's rows dead-ended on a link. So the roster keeps the question it
 * alone answers (who is working, when) and reduces the rest to this summary,
 * composed from the same reader Today's detection runs on
 * (`courseCrewCountsByTrip`, src/db/today.ts + `courseCrewGap`,
 * src/lib/course-ratios.ts). There is no second detector, and no second set of
 * words — the surface that can crew a boat owns them
 * (ADR 20260806-staffing-is-the-shift-roster, ADR 20260803-not-ready-is-a-view).
 *
 * Advisory throughout: booking-time ratio enforcement stays in
 * `createBookingRecord` (src/db/bookings.ts). Nothing here refuses anything.
 */
export type StaffingCrewGaps = {
  /** Scheduled departures overlapping the window — the summary's denominator. */
  departures: number;
  /**
   * How many of them have nobody rostered at all, or a course crew gap
   * `courseCrewGap` reports (an instructorless session, or one booked past its
   * ratio). Zero-crew is a plain fact off the assignment rows, not a rule.
   */
  needCrew: number;
};

/** A trip a staff member crews, shown on their staffing card (task 165). */
export type StaffCrewingTrip = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
};

export type StaffingView = {
  from: Date;
  to: Date;
  staff: {
    person: typeof people.$inferSelect;
    roles: string[];
    capabilities: StaffCapability[];
    shifts: (typeof staffShifts.$inferSelect)[];
    /** Trips in this window this person is on the crew of — a shift with no
     * boat and a boat with no shift are otherwise invisible to each other
     * (Lens 17 task 165). */
    crewingTrips: StaffCrewingTrip[];
  }[];
  /** The one line this page says about crewing; see {@link StaffingCrewGaps}. */
  crewGaps: StaffingCrewGaps;
};

export async function getStaffingView(
  db: AppDb,
  shopId: string,
  from: Date,
  to: Date,
): Promise<StaffingView> {
  const [staffRows, shiftRows, tripCourseRows, crewRows] = await Promise.all([
    listStaff(db, shopId),
    db
      .select({ shift: staffShifts })
      .from(staffShifts)
      .innerJoin(people, eq(people.id, staffShifts.personId))
      .where(
        and(
          eq(staffShifts.shopId, shopId),
          lt(staffShifts.startsAt, to),
          gt(staffShifts.endsAt, from),
        ),
      )
      .orderBy(asc(staffShifts.startsAt)),
    // Trip + course + booked count, independent of who (if anyone) crews it —
    // `courseCrewGap` needs the course's ratio inputs (agency,
    // minimumCertificationLevel) and the booked count on every trip in the
    // window, not just the ones with a crew gap.
    db
      .select({ trip: trips, course: courses, booked: count(bookings.id) })
      .from(trips)
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          lt(trips.startsAt, to),
          gt(trips.endsAt, from),
        ),
      )
      .groupBy(trips.id, courses.id)
      .orderBy(asc(trips.startsAt)),
    // Crew assignments, queried separately from the trip/course row above so
    // this join's fan-out never multiplies the booked count computed alongside
    // it. Who is rostered, not what they are qualified for: the ratio inputs
    // come from Today's own reader further down, so this no longer joins
    // `person_roles` at all.
    db
      .select({
        tripId: tripAssignments.tripId,
        personId: people.id,
      })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(
        and(
          liveTrip(),
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          lt(trips.startsAt, to),
          gt(trips.endsAt, from),
          isNull(people.deletedAt),
        ),
      ),
  ]);

  const shiftsByPerson = new Map<string, (typeof staffShifts.$inferSelect)[]>();
  for (const row of shiftRows) {
    const shifts = shiftsByPerson.get(row.shift.personId) ?? [];
    shifts.push(row.shift);
    shiftsByPerson.set(row.shift.personId, shifts);
  }

  type TripEntry = {
    trip: typeof trips.$inferSelect;
    course: typeof courses.$inferSelect | null;
    booked: number;
    /** Person ids rostered on this trip, in no particular order. */
    crew: Set<string>;
  };
  const tripMap = new Map<string, TripEntry>();
  for (const row of tripCourseRows) {
    tripMap.set(row.trip.id, {
      trip: row.trip,
      course: row.course,
      booked: row.booked,
      crew: new Set(),
    });
  }
  for (const row of crewRows) {
    tripMap.get(row.tripId)?.crew.add(row.personId);
  }

  const crewingByPerson = new Map<string, StaffCrewingTrip[]>();
  for (const entry of tripMap.values()) {
    for (const personId of entry.crew) {
      const trips = crewingByPerson.get(personId) ?? [];
      trips.push({
        tripId: entry.trip.id,
        title: entry.trip.title,
        startsAt: entry.trip.startsAt,
        endsAt: entry.trip.endsAt,
      });
      crewingByPerson.set(personId, trips);
    }
  }
  for (const trips of crewingByPerson.values()) {
    trips.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  const staff = staffRows.map((entry) => ({
    ...entry,
    capabilities: capabilitiesForRoles(entry.roles),
    shifts: shiftsByPerson.get(entry.person.id) ?? [],
    crewingTrips: crewingByPerson.get(entry.person.id) ?? [],
  }));

  // Today's own reader, not a second one: `courseCrewCountsByTrip`
  // (src/db/today.ts) is what `instructor_missing` is computed from, and it
  // counts in-water crew by the one definition every ratio gate shares
  // (`countInWaterCrew`, src/lib/crew-roles.ts) — a divemaster rostered as
  // this trip's captain is not their own assistant here either.
  const crewCounts = await courseCrewCountsByTrip(db, shopId, [...tripMap.keys()]);
  let needCrew = 0;
  for (const entry of tripMap.values()) {
    // Nobody rostered at all — read straight off the assignment rows. It is
    // the one crew fact that is not a rule, and the boat it describes needs
    // people whether or not a course ratio applies.
    if (entry.crew.size === 0) {
      needCrew += 1;
      continue;
    }
    const counts = crewCounts.get(entry.trip.id) ?? { instructorCount: 0, assistantCount: 0 };
    const gap = courseCrewGap({
      course: entry.course,
      instructorCount: counts.instructorCount,
      assistantCount: counts.assistantCount,
      booked: entry.booked,
    });
    if (gap.code !== "none") needCrew += 1;
  }

  return { from, to, staff, crewGaps: { departures: tripMap.size, needCrew } };
}

/**
 * Which of a trip's assigned crew (`personIds`) have a staff shift
 * overlapping the trip's own window — the other half of task 165's
 * cross-link, read from the trip's `CrewSection` rather than the staffing
 * page.
 *
 * `null` means the shop has never scheduled a shift at all, so the question
 * does not apply — a different answer from "nobody is covered". Without the
 * distinction, a shop that doesn't use the staffing feature saw a "Not on a
 * shift" warning on every crew member of every trip, forever: the expected
 * state formatted as an alert (design principle 9). The consumer renders no
 * coverage state at all on `null`; the warning is reserved for shops whose
 * own shift schedule says this sailing has a hole in it.
 */
export async function crewShiftCoverage(
  db: AppDb,
  shopId: string,
  trip: { startsAt: Date; endsAt: Date },
  personIds: readonly string[],
): Promise<Set<string> | null> {
  // Existence probe, deliberately unscoped to the trip window: "does this
  // shop schedule shifts" is a fact about the shop, and a week nobody entered
  // shifts for at a shop that does schedule them is exactly when the warning
  // is earned.
  const usesShifts = await db
    .select({ personId: staffShifts.personId })
    .from(staffShifts)
    .where(eq(staffShifts.shopId, shopId))
    .limit(1);
  if (usesShifts.length === 0) return null;
  if (personIds.length === 0) return new Set();
  const rows = await db
    .select({ personId: staffShifts.personId })
    .from(staffShifts)
    .where(
      and(
        eq(staffShifts.shopId, shopId),
        inArray(staffShifts.personId, [...personIds]),
        lt(staffShifts.startsAt, trip.endsAt),
        gt(staffShifts.endsAt, trip.startsAt),
      ),
    );
  return new Set(rows.map((row) => row.personId));
}

export type CreateStaffShiftOutcome =
  | { ok: true; shift: typeof staffShifts.$inferSelect }
  | { ok: false; reason: "staff_not_found" | "overlap" | "invalid" };

export async function createStaffShift(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    startsAt: Date;
    endsAt: Date;
    note?: string | null;
    createdByPersonId?: string | null;
  },
): Promise<CreateStaffShiftOutcome> {
  if (input.endsAt <= input.startsAt) return { ok: false, reason: "invalid" };
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          inArray(personRoles.role, [...STAFF_ROLES]),
        ),
      )
      .limit(1);
    if (!staff) return { ok: false, reason: "staff_not_found" };
    const [overlap] = await tx
      .select({ id: staffShifts.id })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.shopId, input.shopId),
          eq(staffShifts.personId, input.personId),
          lt(staffShifts.startsAt, input.endsAt),
          gt(staffShifts.endsAt, input.startsAt),
        ),
      )
      .limit(1);
    if (overlap) return { ok: false, reason: "overlap" };
    const [shift] = await tx
      .insert(staffShifts)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        note: input.note?.trim() || null,
        createdByPersonId: input.createdByPersonId ?? null,
      })
      .returning();
    if (!shift) return { ok: false, reason: "invalid" };
    return { ok: true, shift };
  });
}

export async function deleteStaffShift(
  db: AppDb,
  shopId: string,
  shiftId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(staffShifts)
    .where(and(eq(staffShifts.id, shiftId), eq(staffShifts.shopId, shopId)))
    .returning({ id: staffShifts.id });
  return deleted.length > 0;
}
