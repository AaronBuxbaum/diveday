import { and, asc, count, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import { STAFF_ROLES } from "@/lib/authz";
import { type CourseCrewGap, courseCrewGap } from "@/lib/course-ratios";
import { countInWaterCrew, type TripCrewRole } from "@/lib/crew-roles";
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
import { listStaff } from "./trips";

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
 * Why a trip's staffing is not yet settled. A code, not a sentence: the data
 * layer states the fact and the UI renders the words for the reader's locale.
 * An English string returned from here would be copy that no translation pass
 * and no `pnpm check:copy` scan can reach (docs ADR
 * 20260730-staff-copy-localization).
 */
export type StaffingGapCode =
  | "no_crew"
  | "course_needs_instructor"
  | "over_ratio"
  | "no_shift_coverage";

/**
 * The two course-crew gaps this list can show, named as `courseCrewGap`
 * (src/lib/course-ratios.ts) names them. Coverage reads that one computation —
 * the same one the trip page and the Today queue read — instead of re-deriving
 * a rule of its own, and reports its two codes *separately*: an over-ratio
 * session already has an instructor, so filing it under
 * `course_needs_instructor` told a manager to do something they had already
 * done, and hid the ratio Today and the trip page were both shouting about.
 *
 * Written as an exhaustive record rather than a chain of ifs so that a new
 * `CourseCrewGap` code is a compile error here — a silently unmapped gap would
 * be a session this page calls "Covered" while the other two surfaces flag it.
 *
 * Advisory throughout: booking-time ratio enforcement stays in
 * `createBookingRecord` (src/db/bookings.ts). Nothing here refuses anything.
 */
const COURSE_GAP_CODES: Record<Exclude<CourseCrewGap["code"], "none">, StaffingGapCode> = {
  no_instructor: "course_needs_instructor",
  over_ratio: "over_ratio",
};

/** `courseCrewGap`'s verdict as the zero-or-one gap codes coverage lists. */
function courseGapCodes(gap: CourseCrewGap): StaffingGapCode[] {
  return gap.code === "none" ? [] : [COURSE_GAP_CODES[gap.code]];
}

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
  trips: {
    trip: typeof trips.$inferSelect;
    courseTitle: string | null;
    crew: { personId: string; name: string; roles: string[] }[];
    coveredByShift: boolean;
    gaps: StaffingGapCode[];
  }[];
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
    // window, not just the ones with a coverage gap.
    db
      .select({ trip: trips, course: courses, booked: count(bookings.id) })
      .from(trips)
      .leftJoin(courses, eq(courses.id, trips.courseId))
      .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
      .where(
        and(
          eq(trips.shopId, shopId),
          eq(trips.status, "scheduled"),
          lt(trips.startsAt, to),
          gt(trips.endsAt, from),
        ),
      )
      .groupBy(trips.id, courses.id)
      .orderBy(asc(trips.startsAt)),
    // Crew assignments, queried separately from the trip/course row above so
    // this join's fan-out (one row per assignment×role) never multiplies the
    // booked count computed alongside it.
    db
      .select({
        tripId: tripAssignments.tripId,
        personId: people.id,
        personName: people.fullName,
        tripRole: tripAssignments.tripRole,
        role: personRoles.role,
      })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .leftJoin(personRoles, eq(personRoles.personId, tripAssignments.personId))
      .where(
        and(
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
    courseTitle: string | null;
    course: typeof courses.$inferSelect | null;
    booked: number;
    crew: {
      personId: string;
      name: string;
      /** Shop-wide roles; what the ratio reads together with `tripRole`. */
      roles: string[];
      /** The job this person is rostered to do on this trip, or null. */
      tripRole: TripCrewRole | null;
    }[];
  };
  const tripMap = new Map<string, TripEntry>();
  for (const row of tripCourseRows) {
    tripMap.set(row.trip.id, {
      trip: row.trip,
      courseTitle: row.course?.title ?? null,
      course: row.course,
      booked: row.booked,
      crew: [],
    });
  }
  for (const row of crewRows) {
    const entry = tripMap.get(row.tripId);
    if (!entry) continue;
    let crew = entry.crew.find((member) => member.personId === row.personId);
    if (!crew) {
      crew = {
        personId: row.personId,
        name: row.personName,
        roles: [],
        tripRole: row.tripRole,
      };
      entry.crew.push(crew);
    }
    if (row.role && !crew.roles.includes(row.role)) crew.roles.push(row.role);
  }

  const crewingByPerson = new Map<string, StaffCrewingTrip[]>();
  for (const entry of tripMap.values()) {
    for (const member of entry.crew) {
      const trips = crewingByPerson.get(member.personId) ?? [];
      trips.push({
        tripId: entry.trip.id,
        title: entry.trip.title,
        startsAt: entry.trip.startsAt,
        endsAt: entry.trip.endsAt,
      });
      crewingByPerson.set(member.personId, trips);
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

  const tripsView = [...tripMap.values()].map((entry) => {
    // One definition of who is an in-water instructor or certified assistant
    // (`countInWaterCrew`, src/lib/crew-roles.ts), shared with the booking
    // gate, Today, and the trip page — a divemaster rostered as this trip's
    // captain is not their own assistant here either.
    const { instructorCount, assistantCount } = countInWaterCrew(
      entry.crew.map((member) => ({ tripRole: member.tripRole, shopRoles: member.roles })),
    );
    // The one "course crew gap" computation (Lens 17 task 151) — also
    // consumed by the trip page and the Today queue — so a course this window
    // calls covered isn't secretly over its ratio on Today, and the two
    // surfaces name the same shortfall the same way.
    const gap = courseCrewGap({
      course: entry.course,
      instructorCount,
      assistantCount,
      booked: entry.booked,
    });
    const crewShifted = entry.crew.some((member) =>
      (shiftsByPerson.get(member.personId) ?? []).some(
        (shift) => shift.startsAt < entry.trip.endsAt && shift.endsAt > entry.trip.startsAt,
      ),
    );
    const gaps: StaffingGapCode[] = [
      ...(entry.crew.length === 0 ? (["no_crew"] as const) : []),
      ...courseGapCodes(gap),
      ...(!crewShifted ? (["no_shift_coverage"] as const) : []),
    ];
    return {
      trip: entry.trip,
      courseTitle: entry.courseTitle,
      crew: entry.crew,
      coveredByShift: crewShifted,
      gaps,
    };
  });

  return { from, to, staff, trips: tripsView };
}

/**
 * Which of a trip's assigned crew (`personIds`) have a staff shift
 * overlapping the trip's own window — the other half of task 165's
 * cross-link, read from the trip's `CrewSection` rather than the staffing
 * page.
 */
export async function crewShiftCoverage(
  db: AppDb,
  shopId: string,
  trip: { startsAt: Date; endsAt: Date },
  personIds: readonly string[],
): Promise<Set<string>> {
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
