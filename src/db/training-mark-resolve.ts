import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { courseSeatCapacity } from "@/lib/course-ratios";
import { groupCrewAssignments } from "@/lib/crew-roles";
import type { ParticipantType } from "@/lib/participant-types";
import {
  type CrewMember,
  courseInstructorsAboard,
  type TrainingDiveCourse,
  type TrainingMarkEnrollment,
  type TrainingMarkSeat,
  type TrainingMarkState,
  trainingMarkProblem,
} from "@/lib/training-mark";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  bookings,
  courses,
  personRoles,
  rollCallCrewEvents,
  tripAssignments,
  trips,
} from "./schema";
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
  /**
   * What the course says about levels, and its agency for the ratio;
   * `undefined` when the course row is gone (issue #2731).
   */
  course: (TrainingDiveCourse & { agency: string }) | undefined;
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
      courseCertifiesLevel: courses.certifiesLevel,
      courseIsIntro: courses.isIntroCourse,
      courseAgency: courses.agency,
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
      course:
        row.courseRowId === null
          ? undefined
          : {
              minimumLevel: row.courseMinimumLevel,
              certifiesLevel: row.courseCertifiesLevel,
              intro: row.courseIsIntro ?? false,
              agency: row.courseAgency ?? "",
            },
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
 * Each of these departures' crew a training dive may count on, one entry per
 * person, read the way the course ratio reads it (`tripCourseCrewCounts`):
 * every assignment with every standing role, so the per-trip role decides.
 * Only an assignment **someone else** made counts (the rule of
 * `teachesSessionAsRostered`, review 2026-10-17), and on a departure, nobody
 * the departure's crew count has marked not aboard.
 */
async function trustedCrewOfTrips(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, CrewMember[]>> {
  const byTrip = new Map<string, CrewMember[]>();
  if (tripIds.length === 0) return byTrip;
  const ids = [...new Set(tripIds)];
  const [rows, counted] = await queryAll(db, [
    () =>
      db
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
            inArray(tripAssignments.tripId, ids),
            isNotNull(tripAssignments.assignedByPersonId),
            ne(tripAssignments.assignedByPersonId, tripAssignments.personId),
            liveTrip(),
          ),
        ),
    () =>
      db
        .select({
          tripId: rollCallCrewEvents.tripId,
          personId: rollCallCrewEvents.personId,
          status: rollCallCrewEvents.status,
        })
        .from(rollCallCrewEvents)
        .where(
          and(
            eq(rollCallCrewEvents.shopId, shopId),
            inArray(rollCallCrewEvents.tripId, ids),
            eq(rollCallCrewEvents.checkpoint, "departure"),
          ),
        )
        // diveday:allow-time-id-order: the latest mark per person wins; nobody is shown this order.
        .orderBy(
          asc(rollCallCrewEvents.occurredAt),
          asc(rollCallCrewEvents.createdAt),
          asc(rollCallCrewEvents.seq),
        ),
  ]);
  // The latest crew-count mark per (trip, person): "not boarded" keeps them off.
  const latest = new Map<string, string>();
  for (const event of counted) latest.set(`${event.tripId}:${event.personId}`, event.status);
  const rowsByTrip = new Map<string, typeof rows>();
  for (const row of rows) {
    if (latest.get(`${row.tripId}:${row.personId}`) === "not_boarded") continue;
    const list = rowsByTrip.get(row.tripId) ?? [];
    list.push(row);
    rowsByTrip.set(row.tripId, list);
  }
  for (const [tripId, list] of rowsByTrip) byTrip.set(tripId, groupCrewAssignments(list));
  return byTrip;
}

/** A (departure, course session) pair, with the course whose ratio applies. */
type AboardPair = {
  departureTripId: string;
  sessionTripId: string;
  course: TrainingEnrollmentRow["course"];
};

/**
 * **How many of the course's students this departure can carry as training
 * dives** (issue #2731; review 2026-10-17), keyed by `aboardKey`: the
 * course's ratio over its instructors aboard (`courseInstructorsAboard`),
 * with the seats already marked for that session, oldest mark first. Zero
 * with no instructor aboard; `null` capacity for a course with no ratio rule.
 */
export async function trainingDiveRoom(
  db: DbExecutor,
  shopId: string,
  pairs: readonly AboardPair[],
): Promise<Map<string, { capacity: number | null; marked: string[] }>> {
  const room = new Map<string, { capacity: number | null; marked: string[] }>();
  if (pairs.length === 0) return room;
  const crew = await trustedCrewOfTrips(
    db,
    shopId,
    pairs.flatMap((pair) => [pair.departureTripId, pair.sessionTripId]),
  );
  const enrollmentSeats = alias(bookings, "training_room_enrollments");
  const marked = await db
    .select({
      id: bookings.id,
      departureTripId: bookings.tripId,
      sessionTripId: enrollmentSeats.tripId,
    })
    .from(bookings)
    .innerJoin(
      enrollmentSeats,
      and(
        eq(enrollmentSeats.id, bookings.trainingEnrollmentBookingId),
        eq(enrollmentSeats.shopId, shopId),
      ),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.tripId, [...new Set(pairs.map((pair) => pair.departureTripId))]),
        ne(bookings.status, "cancelled"),
        isNotNull(bookings.trainingMarkedAt),
      ),
    )
    // diveday:allow-time-id-order: the earliest marks are the ones the ratio seats first.
    .orderBy(asc(bookings.trainingMarkedAt), asc(bookings.id));
  for (const pair of pairs) {
    const key = aboardKey(pair.departureTripId, pair.sessionTripId);
    if (room.has(key)) continue;
    const instructors = courseInstructorsAboard(
      crew.get(pair.sessionTripId) ?? [],
      crew.get(pair.departureTripId) ?? [],
    );
    const capacity =
      instructors === 0
        ? 0
        : courseSeatCapacity(
            pair.course
              ? {
                  agency: pair.course.agency,
                  minimumCertificationLevel: pair.course.minimumLevel,
                  isIntroCourse: pair.course.intro,
                }
              : null,
            instructors,
            0,
          );
    room.set(key, {
      capacity,
      marked: marked
        .filter(
          (row) =>
            row.departureTripId === pair.departureTripId &&
            row.sessionTripId === pair.sessionTripId,
        )
        .map((row) => row.id),
    });
  }
  return room;
}

/** Whether this marked seat is within the room `trainingDiveRoom` found. */
export function seatWithinRoom(
  room: { capacity: number | null; marked: string[] } | undefined,
  bookingId: string,
): boolean {
  if (!room || room.capacity === 0) return false;
  if (room.capacity === null) return true;
  const position = room.marked.indexOf(bookingId);
  return position !== -1 && position < room.capacity;
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
      ? [{ departureTripId: tripId, sessionTripId: enrollment.tripId, course: enrollment.course }]
      : [];
  });
  const room = await trainingDiveRoom(db, shopId, standing);
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
            enrollmentCourse: enrollment.course && {
              minimumLevel: enrollment.course.minimumLevel,
              certifiesLevel: enrollment.course.certifiesLevel,
              intro: enrollment.course.intro,
            },
            courseInstructorAboard: seatWithinRoom(
              room.get(aboardKey(tripId, enrollment.tripId)),
              bookingId,
            ),
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
 * **The courses a staff mark could make this departure answer to**, for the
 * sale (issue #2731). Readiness lowers a standing mark's level to its
 * course's minimum (`trainingDiveRequiredLevel`) while an instructor of the
 * course is aboard for the seat, and the sale must never refuse a seat
 * readiness would clear. So for a diver about to buy a seat on `departure`:
 * each of their course seats a mark could name (`trainingMarkProblem` finds
 * nothing, the course row is readable) whose course has room aboard
 * `departure` for one more marked seat (`trainingDiveRoom`). Never a mark:
 * the seat still boards on the departure's level until staff mark it.
 */
export async function markableTrainingDives(
  db: DbExecutor,
  shopId: string,
  personId: string,
  departure: { id: string; startsAt: Date },
): Promise<TrainingDiveCourse[]> {
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
      enrollment.course !== undefined &&
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
  const room = await trainingDiveRoom(
    db,
    shopId,
    markable.map((enrollment) => ({
      departureTripId: departure.id,
      sessionTripId: enrollment.tripId,
      course: enrollment.course,
    })),
  );
  return markable.flatMap((enrollment) => {
    const left = room.get(aboardKey(departure.id, enrollment.tripId));
    const fits =
      left !== undefined &&
      left.capacity !== 0 &&
      (left.capacity === null || left.marked.length < left.capacity);
    return fits && enrollment.course
      ? [
          {
            minimumLevel: enrollment.course.minimumLevel,
            certifiesLevel: enrollment.course.certifiesLevel,
            intro: enrollment.course.intro,
          },
        ]
      : [];
  });
}
