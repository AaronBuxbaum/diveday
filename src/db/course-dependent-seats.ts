import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { inTrainingBefore } from "@/lib/in-training";
import { SEAT_HELD_STATUSES } from "@/lib/no-show";
import { decideTripAdmission } from "@/lib/trip-admission";
import { readCertificationEvidence } from "./certification-evidence";
import { listCourseSeatsInTraining } from "./certifications-in-training";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import { tripRequirementSummaries } from "./readiness";
import { bookings, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** A charter seat that was sold on a course seat, named for the confirm. */
export type DependentCharter = {
  bookingId: string;
  tripId: string;
  title: string;
  startsAt: Date;
};

/**
 * **The charter seats a course seat carries** (issue #2058, Aaron 2026-10-13):
 * for each student on this course session, the departures ahead the booking
 * door sold them only because this course gets them to the level. Admission
 * is asked twice, with every course seat and without this one; a seat that
 * passes the first and fails the second relies on this course. The cancel and
 * move confirmations on the course seat name them, so nobody finds out at the
 * dock.
 *
 * A warning, never a gate: the charter seat stays booked, and readiness still
 * waits for the card whatever happens here. A held seat (H-20260724-one-person-per-email) is admitted on
 * no evidence, so it relies on nothing and is never named.
 */
export async function chartersRelyingOnCourseSeats(
  db: DbExecutor,
  shopId: string,
  courseTripId: string,
  seats: readonly { bookingId: string; personId: string }[],
  now: Date,
): Promise<Map<string, DependentCharter[]>> {
  const result = new Map<string, DependentCharter[]>();
  if (seats.length === 0) return result;
  const personIds = [...new Set(seats.map((seat) => seat.personId))];
  const [courseSeats, charters] = await queryAll(db, [
    () => listCourseSeatsInTraining(db, shopId, personIds),
    () =>
      db
        .select({
          bookingId: bookings.id,
          personId: bookings.personId,
          tripId: trips.id,
          title: trips.title,
          startsAt: trips.startsAt,
        })
        .from(bookings)
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
        .where(
          and(
            eq(bookings.shopId, shopId),
            inArray(bookings.personId, personIds),
            inArray(bookings.status, [...SEAT_HELD_STATUSES]),
            eq(bookings.participantType, "diver"),
            isNull(bookings.identityUnconfirmedAt),
            isNull(trips.courseId),
            eq(trips.status, "scheduled"),
            gt(trips.startsAt, now),
            liveTrip(),
          ),
        ),
  ]);
  // Only a student whose seat here certifies a level can carry anything.
  const students = seats.filter((seat) =>
    courseSeats.some(
      (course) => course.tripId === courseTripId && course.personId === seat.personId,
    ),
  );
  const candidates = charters.filter((charter) =>
    students.some((seat) => seat.personId === charter.personId),
  );
  if (candidates.length === 0) return result;

  const requirements = await tripRequirementSummaries(db, shopId, [
    ...new Set(candidates.map((charter) => charter.tripId)),
  ]);
  for (const seat of students) {
    const mine = candidates.filter((charter) => charter.personId === seat.personId);
    if (mine.length === 0) continue;
    const evidence = await readCertificationEvidence(db, shopId, seat.personId);
    const own = courseSeats.filter((course) => course.personId === seat.personId);
    const others = own.filter((course) => course.tripId !== courseTripId);
    const reliant = mine.filter((charter) => {
      const trip = { id: charter.tripId, startsAt: charter.startsAt };
      const admitted = (courses: typeof own) =>
        decideTripAdmission({
          requirement: null,
          siteRequirement: requirements.get(charter.tripId) ?? null,
          evidence: {
            ...evidence,
            levelsInTraining: inTrainingBefore(courses, trip, now).map((course) => course.level),
          },
        }).admitted;
      return admitted(own) && !admitted(others);
    });
    if (reliant.length > 0) {
      result.set(
        seat.bookingId,
        reliant
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map(({ bookingId, tripId, title, startsAt }) => ({
            bookingId,
            tripId,
            title,
            startsAt,
          })),
      );
    }
  }
  return result;
}
