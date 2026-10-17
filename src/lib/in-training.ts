import type { CertificationInTraining } from "./readiness";

/**
 * One course session a diver holds a seat on, and the level that course
 * certifies (read by `listCourseSeatsInTraining`, src/db/certifications-in-training.ts).
 */
export type CourseSeatInTraining = CertificationInTraining & {
  personId: string;
  /** The course session itself, so a trip is never "in training" for its own card. */
  tripId: string;
};

/**
 * The course seats that finish by the time this trip starts, are not the trip
 * itself, and **have not finished yet**. A course that ended without a card
 * is not training any more: the diver did not finish, or the instructor has a
 * tap to make, and either way it stops counting at the sale and at the rail
 * alike. One window, here, so the two gates and every door that asks
 * admission (booking, seat claims, blow-out offers, the next-dive card) cannot
 * drift apart.
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

/**
 * **The course that should have got them there, and has ended** (issue
 * #2058): the latest of the diver's course seats that finished before this
 * trip sails and is already over, so no longer training. A card it should
 * have produced is the instructor's tap on that session's roster, or a word
 * with a student who did not finish; the diver record points there rather
 * than at "Add a card". Never evidence, and never a clearance.
 */
export function courseEndedBefore(
  seats: readonly CourseSeatInTraining[],
  trip: { id: string; startsAt: Date },
  now: Date,
): CourseSeatInTraining[] {
  return seats.filter(
    (seat) =>
      seat.tripId !== trip.id &&
      seat.finishesAt.getTime() <= trip.startsAt.getTime() &&
      seat.finishesAt.getTime() <= now.getTime(),
  );
}
