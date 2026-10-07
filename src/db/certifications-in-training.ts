import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import type { CertificationInTraining } from "@/lib/readiness";
import type { DbExecutor } from "./client";
import { bookings, courses, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** One course session a diver holds a seat on, and the level that course certifies. */
export type CourseSeatInTraining = CertificationInTraining & {
  personId: string;
  /** The course session itself, so a trip is never "in training" for its own card. */
  tripId: string;
};

/**
 * **Which levels each diver is booked to be certified at, and when.**
 *
 * A seat on a scheduled course session, for a course that issues a rung of
 * the ladder (`courses.certifies_level`, issue #2059 — the course's own
 * column, copied from its template, so a course a shop built for itself can
 * say so too and one that issues nothing never counts). One row per session, so
 * a caller measures each against the trip it is deciding: only a session that
 * ends before that trip starts counts (`inTrainingBefore`).
 *
 * Read by both gates, and by neither as evidence. Admission sells the seat on
 * it (`src/lib/trip-admission.ts`); readiness words the blocker more softly
 * and still waits for the card (`src/lib/readiness.ts`).
 */
export async function listCourseSeatsInTraining(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
): Promise<CourseSeatInTraining[]> {
  if (personIds.length === 0) return [];
  const rows = await db
    .select({
      personId: bookings.personId,
      tripId: trips.id,
      finishesAt: trips.endsAt,
      level: courses.certifiesLevel,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.personId, [...personIds]),
        // A diver marked absent did not sit the course, and a cancelled
        // session runs for nobody.
        inArray(bookings.status, [...SEAT_HELD_STATUSES]),
        eq(trips.status, "scheduled"),
        isNotNull(courses.certifiesLevel),
        liveTrip(),
      ),
    );
  return rows.flatMap(({ level, ...row }) => (level ? [{ ...row, level }] : []));
}

/**
 * The course seats that finish by the time this trip starts, are not the trip
 * itself, and **have not finished yet**. A course that ended without a card
 * is not training any more: the diver did not finish, or the instructor has a
 * tap to make, and either way it stops counting at the sale and at the rail
 * alike. One window, here, so the two gates cannot drift apart.
 */
export function inTrainingBefore(
  seats: readonly CourseSeatInTraining[],
  trip: { id: string; startsAt: Date },
  now: Date,
): CertificationInTraining[] {
  return seats
    .filter(
      (seat) =>
        seat.tripId !== trip.id &&
        seat.finishesAt.getTime() <= trip.startsAt.getTime() &&
        seat.finishesAt.getTime() > now.getTime(),
    )
    .map(({ level, finishesAt }) => ({ level, finishesAt }));
}
