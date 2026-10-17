import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { CertificationLevel } from "@/lib/certification-levels";
import { groupCrewAssignments } from "@/lib/crew-roles";
import type { ParticipantType } from "@/lib/participant-types";
import {
  type CrewMember,
  courseInstructorAboard,
  type TrainingMarkEnrollment,
  type TrainingMarkSeat,
  type TrainingMarkState,
  trainingMarkProblem,
} from "@/lib/training-mark";
import type { DbExecutor } from "./client";
import { bookings, courses, personRoles, tripAssignments, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The one resolver from a marked seat to its enrollment** (issue #2275,
 * dive-domain review item 6). Readiness, the forms page, the signature and
 * the paper record, the guardian's half and the link a staffer sends all ask
 * here, so no reader can follow a mark another one refuses.
 *
 * Split from `./training-marks` (the writers and the roster's view) so
 * `./course-forms` can read it without importing the module that reads
 * course forms back.
 */

/** A marked enrollment as the readers need it, beside what the rule reads. */
export type TrainingEnrollmentRow = TrainingMarkEnrollment & {
  bookingId: string;
  tripId: string;
  sessionStartsAt: Date;
  /** The course seat's booker said "Under 18". */
  minorDeclared: boolean;
  /** The course's title, or the session's when the course row is gone. */
  courseTitle: string;
  /** The course's own minimum level; `undefined` when the course row is gone (issue #2731). */
  courseMinimumLevel: CertificationLevel | null | undefined;
};

/**
 * The bookings these ids name **at this shop**, on a departure that is not
 * deleted, keyed by id. An id that is another shop's, or on a deleted
 * departure, is simply absent, which the rule reads as `enrollment_missing`.
 */
export async function readTrainingEnrollments(
  db: DbExecutor,
  shopId: string,
  bookingIds: readonly string[],
): Promise<Map<string, TrainingEnrollmentRow>> {
  const result = new Map<string, TrainingEnrollmentRow>();
  if (bookingIds.length === 0) return result;
  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      status: bookings.status,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      minorDeclaredAt: bookings.minorDeclaredAt,
      participantType: bookings.participantType,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStatus: trips.status,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      courseTitle: courses.title,
      courseRowId: courses.id,
      courseMinimumLevel: courses.minimumCertificationLevel,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.id, [...new Set(bookingIds)]),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    );
  for (const row of rows) {
    result.set(row.bookingId, {
      bookingId: row.bookingId,
      personId: row.personId,
      status: row.status,
      identityHeld: row.identityUnconfirmedAt !== null,
      participantType: row.participantType as ParticipantType,
      courseId: row.courseId,
      departureCanceled: row.tripStatus === "cancelled",
      sessionEndsAt: row.endsAt,
      tripId: row.tripId,
      sessionStartsAt: row.startsAt,
      minorDeclared: row.minorDeclaredAt !== null,
      courseTitle: row.courseTitle ?? row.tripTitle,
      courseMinimumLevel: row.courseRowId === null ? undefined : row.courseMinimumLevel,
    });
  }
  return result;
}

/** A marked seat, as a reader holds it. */
export type MarkedSeat = {
  bookingId: string;
  /** The seat's own departure, whose crew says whether the course's instructor is aboard. */
  tripId: string;
  enrollmentBookingId: string;
  seat: TrainingMarkSeat;
};

/**
 * Each of these departures' crew, one entry per person, read the way the
 * course ratio reads it (`tripCourseCrewCounts`): every assignment with every
 * standing role, so the per-trip role decides.
 */
async function crewOfTrips(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, CrewMember[]>> {
  const byTrip = new Map<string, CrewMember[]>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: tripAssignments.tripId,
      personId: tripAssignments.personId,
      tripRole: tripAssignments.tripRole,
      role: personRoles.role,
    })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .leftJoin(personRoles, eq(personRoles.personId, tripAssignments.personId))
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(tripAssignments.tripId, [...new Set(tripIds)]),
        liveTrip(),
      ),
    );
  const rowsByTrip = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = rowsByTrip.get(row.tripId) ?? [];
    list.push(row);
    rowsByTrip.set(row.tripId, list);
  }
  for (const [tripId, list] of rowsByTrip) byTrip.set(tripId, groupCrewAssignments(list));
  return byTrip;
}

/**
 * For each (departure, course session) pair, whether the course's instructor
 * is aboard that departure (`courseInstructorAboard`, issue #2731), keyed by
 * `aboardKey`. One read for every pair.
 */
export async function courseInstructorsAboard(
  db: DbExecutor,
  shopId: string,
  pairs: readonly { departureTripId: string; sessionTripId: string }[],
): Promise<Set<string>> {
  const aboard = new Set<string>();
  if (pairs.length === 0) return aboard;
  const crew = await crewOfTrips(
    db,
    shopId,
    pairs.flatMap((pair) => [pair.departureTripId, pair.sessionTripId]),
  );
  for (const { departureTripId, sessionTripId } of pairs) {
    if (courseInstructorAboard(crew.get(sessionTripId) ?? [], crew.get(departureTripId) ?? [])) {
      aboard.add(aboardKey(departureTripId, sessionTripId));
    }
  }
  return aboard;
}

export function aboardKey(departureTripId: string, sessionTripId: string): string {
  return `${departureTripId}:${sessionTripId}`;
}

/**
 * Whether each marked seat's mark stands, by seat booking id. Every seat
 * handed in has an entry: a mark this cannot prove is `valid: false`, never
 * absent.
 */
export async function resolveTrainingMarks(
  db: DbExecutor,
  shopId: string,
  seats: readonly MarkedSeat[],
): Promise<Map<string, TrainingMarkState>> {
  const result = new Map<string, TrainingMarkState>();
  if (seats.length === 0) return result;
  const enrollments = await readTrainingEnrollments(
    db,
    shopId,
    seats.map((seat) => seat.enrollmentBookingId),
  );
  const standing = seats.flatMap(({ tripId, enrollmentBookingId, seat }) => {
    const enrollment = enrollments.get(enrollmentBookingId) ?? null;
    return enrollment && trainingMarkProblem(seat, enrollment) === null
      ? [{ departureTripId: tripId, sessionTripId: enrollment.tripId }]
      : [];
  });
  const aboard = await courseInstructorsAboard(db, shopId, standing);
  for (const { bookingId, tripId, enrollmentBookingId, seat } of seats) {
    const enrollment = enrollments.get(enrollmentBookingId) ?? null;
    const problem = trainingMarkProblem(seat, enrollment);
    result.set(
      bookingId,
      problem || !enrollment
        ? { valid: false, problem: problem ?? "enrollment_missing" }
        : {
            valid: true,
            enrollmentBookingId,
            enrollmentTripId: enrollment.tripId,
            enrollmentMinorDeclared: enrollment.minorDeclared,
            enrollmentCourseTitle: enrollment.courseTitle,
            enrollmentCourseMinimumLevel: enrollment.courseMinimumLevel,
            courseInstructorAboard: aboard.has(aboardKey(tripId, enrollment.tripId)),
          },
    );
  }
  return result;
}

/**
 * Whether this person is rostered as an instructor on this departure **by
 * someone else** (build review T2): an assignment, or a role, they gave
 * themselves — or one nobody is recorded as giving — proves nothing about who
 * teaches the session, so it fails closed.
 */
export async function teachesSessionAsRostered(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  personId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ tripRole: tripAssignments.tripRole, role: personRoles.role })
    .from(tripAssignments)
    .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
    .leftJoin(
      personRoles,
      and(eq(personRoles.personId, tripAssignments.personId), eq(personRoles.role, "instructor")),
    )
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(tripAssignments.tripId, tripId),
        eq(tripAssignments.personId, personId),
        isNotNull(tripAssignments.assignedByPersonId),
        ne(tripAssignments.assignedByPersonId, personId),
        liveTrip(),
      ),
    );
  return rows.some((row) =>
    row.tripRole === null ? row.role === "instructor" : row.tripRole === "instructor",
  );
}

/**
 * **The course levels a staff mark could make this departure answer to**, for
 * the sale (issue #2731). Readiness takes a standing mark's course minimum in
 * place of the departure's while the course's instructor is aboard, and the
 * sale must never refuse a seat readiness would clear. So for a diver about to
 * buy a seat on `departure`: each of their course seats a mark could name
 * (`trainingMarkProblem` finds nothing, the course row is readable) whose
 * course's instructor is already aboard `departure`. Never a mark: the seat
 * still boards on the departure's level until staff mark it.
 */
export async function markableTrainingDiveLevels(
  db: DbExecutor,
  shopId: string,
  personId: string,
  departure: { id: string; startsAt: Date },
): Promise<(CertificationLevel | null)[]> {
  const seats = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
        ne(bookings.status, "cancelled"),
        eq(trips.shopId, shopId),
        isNotNull(trips.courseId),
        ne(trips.id, departure.id),
        liveTrip(),
      ),
    );
  if (seats.length === 0) return [];
  const enrollments = await readTrainingEnrollments(
    db,
    shopId,
    seats.map((seat) => seat.id),
  );
  const markable = [...enrollments.values()].filter(
    (enrollment) =>
      enrollment.courseMinimumLevel !== undefined &&
      trainingMarkProblem(
        {
          personId,
          participantType: "diver",
          onCourseSession: false,
          departureStartsAt: departure.startsAt,
        },
        enrollment,
      ) === null,
  );
  const aboard = await courseInstructorsAboard(
    db,
    shopId,
    markable.map((enrollment) => ({
      departureTripId: departure.id,
      sessionTripId: enrollment.tripId,
    })),
  );
  return markable
    .filter((enrollment) => aboard.has(aboardKey(departure.id, enrollment.tripId)))
    .map((enrollment) => enrollment.courseMinimumLevel ?? null);
}
