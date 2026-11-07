import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { seatStandsAhead } from "@/lib/guardian";
import type { ParticipantType } from "@/lib/participant-types";
import { trainingMarkProblem } from "@/lib/training-mark";
import { hasReturned } from "@/lib/trips";
import type { DbExecutor } from "./client";
import { bookings, trips } from "./schema";
import { readTrainingEnrollments } from "./training-mark-resolve";

/**
 * **The seats among these whose training mark stands on an enrollment the booker declared
 * "Under 18"** (issue #4103), by seat booking id. The same rule readiness reads in
 * `minorDeclaredOf`: the mark is checked by `trainingMarkProblem`, the enrollment's stamp by
 * `readTrainingEnrollments`, so signing never asks less than boarding does.
 */
export async function enrollmentMinorDeclaredSeats(
  db: DbExecutor,
  shopId: string,
  seats: readonly {
    bookingId: string;
    personId: string;
    participantType: string;
    trainingEnrollmentBookingId: string | null;
    tripCourseId: string | null;
    tripStartsAt: Date;
  }[],
): Promise<Set<string>> {
  const marked = seats.filter((seat) => seat.trainingEnrollmentBookingId !== null);
  const declared = new Set<string>();
  if (marked.length === 0) return declared;
  const enrollments = await readTrainingEnrollments(
    db,
    shopId,
    marked.map((seat) => seat.trainingEnrollmentBookingId as string),
  );
  for (const seat of marked) {
    const enrollment = enrollments.get(seat.trainingEnrollmentBookingId as string) ?? null;
    const problem = trainingMarkProblem(
      {
        personId: seat.personId,
        participantType: seat.participantType as ParticipantType,
        onCourseSession: seat.tripCourseId !== null,
        departureStartsAt: seat.tripStartsAt,
      },
      enrollment,
    );
    if (problem === null && enrollment?.minorDeclared) declared.add(seat.bookingId);
  }
  return declared;
}

/**
 * **The people a booker marked "Under 18" on a seat still ahead** (issue
 * #2553, Option A), for the person-scoped readers with no seat in hand: a
 * counter rental's waiver standing and the diver record's paper release. The
 * rule over the rows is `minorDeclaredOnLiveUpcomingSeat`; the diver record
 * applies it to the seats it already holds. A called-off day's carried
 * preparation reads its own day's stamp too (`calledOffToo`).
 *
 * A seat whose training mark stands on an enrollment declared Under 18 speaks
 * for its person too (`enrollmentMinorDeclaredSeats`), as readiness reads it.
 *
 * Only stamped or marked seats are read, so the query is as small as the stamp is rare.
 * Nothing here writes a date of birth.
 */
export async function peopleMinorDeclared(
  db: DbExecutor,
  input: {
    shopId: string;
    personIds: readonly string[];
    now: Date;
    /**
     * Also a seat whose departure was called off, or the seat itself
     * cancelled, while that day is not yet over: the stranded card on `/ready`
     * is about that very day, so its booker's word still speaks for it.
     */
    calledOffToo?: boolean;
  },
): Promise<Set<string>> {
  const declared = new Set<string>();
  const personIds = [...new Set(input.personIds)];
  if (personIds.length === 0) return declared;
  const seats = await db
    .select({
      bookingId: bookings.id,
      personId: bookings.personId,
      status: bookings.status,
      participantType: bookings.participantType,
      minorDeclaredAt: bookings.minorDeclaredAt,
      trainingEnrollmentBookingId: bookings.trainingEnrollmentBookingId,
      trip: {
        deletedAt: trips.deletedAt,
        status: trips.status,
        endsAt: trips.endsAt,
        courseId: trips.courseId,
        startsAt: trips.startsAt,
      },
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        inArray(bookings.personId, personIds),
        or(isNotNull(bookings.minorDeclaredAt), isNotNull(bookings.trainingEnrollmentBookingId)),
      ),
    );
  const standing = seats.filter((seat) =>
    input.calledOffToo
      ? seat.trip.deletedAt === null && !hasReturned(seat.trip.endsAt, input.now)
      : seatStandsAhead(seat, input.now),
  );
  const viaEnrollment = await enrollmentMinorDeclaredSeats(
    db,
    input.shopId,
    standing
      .filter((seat) => seat.minorDeclaredAt === null)
      .map((seat) => ({
        ...seat,
        tripCourseId: seat.trip.courseId,
        tripStartsAt: seat.trip.startsAt,
      })),
  );
  for (const seat of standing) {
    if (seat.minorDeclaredAt !== null || viaEnrollment.has(seat.bookingId)) {
      declared.add(seat.personId);
    }
  }
  return declared;
}
