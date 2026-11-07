import { offeredParticipantTypes, type ParticipantType } from "./participant-types";

/**
 * **The booking door's own refusals, as pure decisions.** `createBookingRecord`
 * (`src/db/bookings.ts`) reads the rows under the trip lock and asks these;
 * nothing here reads the database, so each rule is tested on its own in
 * `booking-gates.test.ts` rather than only through a seeded booking
 * (fourth review, row 39). A course session's own gates (staffing, card, age,
 * ratio) are `decideCourseAdmission` in `course-admission.ts`.
 *
 * These decide who may *buy* a seat. Who may board is `calculateReadiness`,
 * and admission may never refuse someone readiness would clear (AGENTS.md).
 */

export type BookingActor = "staff" | "public";

/**
 * Whether this departure takes a seat of this type from this door.
 *
 * The public form sells only what the departure prices, read on the locked row
 * rather than trusted from the form's parse: a shop that cleared its rider
 * price between page load and post has stopped selling that seat. Staff may
 * seat any type on an ordinary departure.
 *
 * **A course session's students are divers** (issue #2226, ADR
 * 20261007-participant-types): its admission rule, its ratio and its minimum
 * age are about the student in the water. The snorkeling spouse on the Open
 * Water boat is a separate seat the shop has priced, from either door; an
 * unpriced one is refused even to staff, because on a course session that is
 * how a student would be written aboard as a rider.
 */
export function participantTypeRefusal(input: {
  actor: BookingActor;
  participantType: ParticipantType;
  trip: Parameters<typeof offeredParticipantTypes>[0] & { courseId?: string | null };
}): "participant_type_unavailable" | null {
  if (
    (input.actor === "public" || input.trip.courseId) &&
    !offeredParticipantTypes(input.trip).includes(input.participantType)
  ) {
    return "participant_type_unavailable";
  }
  return null;
}

/**
 * The name a seat was guessed onto a person under, off the counter's name
 * prompt (H-20260724-one-person-per-email, issue #1556).
 */
export type IdentityClaim = { bookedAs: string };

/**
 * The two identity columns a booking row carries, for a fresh insert and a
 * reactivated row alike. A matching name clears a stale flag; a mismatch
 * (re)raises it with what the staffer is shown beside the matched record.
 */
export function bookingIdentityColumns(
  identityUnconfirmed: boolean,
  claim: IdentityClaim | null,
  now: Date,
): {
  identityUnconfirmedAt: Date | null;
  identityBookedAs: string | null;
  heldEmergencyContactName: null;
  heldEmergencyContactPhone: null;
} {
  return {
    identityUnconfirmedAt: identityUnconfirmed ? now : null,
    identityBookedAs: identityUnconfirmed ? (claim?.bookedAs ?? null) : null,
    // A seat (re)written starts with no desk-recorded contact of its own
    // (issue #2145): one from an earlier hold on a reactivated row was about
    // whoever stood at the counter then.
    heldEmergencyContactName: null,
    heldEmergencyContactPhone: null,
  };
}
