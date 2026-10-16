import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { CourseSeatInTraining } from "@/lib/in-training";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import type { DbExecutor } from "./client";
import { bookings, courses, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Which levels each diver is booked to be certified at, and when.**
 *
 * A seat on a scheduled course session, for a course that issues a rung of
 * the ladder (`courses.certifies_level`, issue #2059 — copied from the
 * course's template and owned by it, so no editor changes it; a course a shop
 * built without a template issues nothing and never counts). One row per session, so
 * a caller measures each against the trip it is deciding: only a session that
 * ends before that trip starts counts (`inTrainingBefore`, src/lib/in-training.ts).
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
        // A snorkeler or a rider on the session is aboard, not enrolled
        // (issue #2226): only a diver's seat is a student's.
        eq(bookings.participantType, "diver"),
        eq(trips.status, "scheduled"),
        isNotNull(courses.certifiesLevel),
        liveTrip(),
      ),
    );
  return rows.flatMap(({ level, ...row }) => (level ? [{ ...row, level }] : []));
}
