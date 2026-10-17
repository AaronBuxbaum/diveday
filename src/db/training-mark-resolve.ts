import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { ParticipantType } from "@/lib/participant-types";
import {
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
    });
  }
  return result;
}

/** A marked seat, as a reader holds it. */
export type MarkedSeat = {
  bookingId: string;
  enrollmentBookingId: string;
  seat: TrainingMarkSeat;
};

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
  for (const { bookingId, enrollmentBookingId, seat } of seats) {
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
          },
    );
  }
  return result;
}

/**
 * One booking's training mark: `none` for a seat with no mark (a course seat
 * included), otherwise the resolved state. Null when the booking is not a
 * seat of this shop on a live departure.
 */
export async function trainingMarkForBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<{ marked: false } | ({ marked: true } & TrainingMarkState) | null> {
  const [row] = await db
    .select({
      personId: bookings.personId,
      participantType: bookings.participantType,
      enrollmentBookingId: bookings.trainingEnrollmentBookingId,
      courseId: trips.courseId,
      startsAt: trips.startsAt,
    })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        liveTrip(),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.enrollmentBookingId === null) return { marked: false };
  const states = await resolveTrainingMarks(db, shopId, [
    {
      bookingId,
      enrollmentBookingId: row.enrollmentBookingId,
      seat: {
        personId: row.personId,
        participantType: row.participantType as ParticipantType,
        onCourseSession: row.courseId !== null,
        departureStartsAt: row.startsAt,
      },
    },
  ]);
  const state = states.get(bookingId) ?? { valid: false, problem: "enrollment_missing" };
  return { marked: true, ...state };
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
