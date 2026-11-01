import type { Certification } from "@/db/schema";
import { checkMinimumAge } from "./age";
import type { CalendarDate } from "./calendar-date";
import type { CertificationLevel } from "./certification-levels";
import { offeredParticipantTypes, type ParticipantType } from "./participant-types";
import { hasVerifiedCertificationAtLeast } from "./readiness";

/**
 * **The booking door's own refusals, as pure decisions.** `createBookingRecord`
 * (`src/db/bookings.ts`) reads the rows under the trip lock and asks these;
 * nothing here reads the database, so each rule is tested on its own in
 * `booking-gates.test.ts` rather than only through a seeded booking
 * (fourth review, row 39).
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
 * A course's enrollment gates, in the order they apply.
 *
 * **The card gate fails closed.** A course that needs an existing card admits
 * only a diver whose verified card meets it; a walk-in with no record yet has
 * none, and a self-assertion never reserves a seat. Staff can sight the card,
 * and the same public form then admits the diver.
 *
 * **The age gate fails open, and is staff's alone** (H-20260724-certification-levels-agency-rules). Measured on the day
 * the course runs. A diver with no date of birth on file, or no record yet,
 * books as before, because nothing collects one at booking and failing closed
 * would lock out everyone already on the books. The anonymous form never
 * refuses on someone else's date of birth (`BookingRequest.actor`); an under-age
 * seat it sells surfaces as a readiness blocker instead.
 */
export function courseEnrollmentRefusal(input: {
  actor: BookingActor;
  course: { minimumCertificationLevel: CertificationLevel | null; minimumAge: number | null };
  /** Null when the booking has no person row yet (a walk-in, written later). */
  diver: { cards: readonly Certification[]; dateOfBirth: CalendarDate | null } | null;
  /** The course day in the shop's calendar; needed only for the age gate. */
  courseDate: CalendarDate | null;
}): "course_prerequisite" | "course_min_age" | null {
  const { course, diver } = input;
  if (course.minimumCertificationLevel) {
    if (!diver) return "course_prerequisite";
    if (!hasVerifiedCertificationAtLeast(diver.cards, course.minimumCertificationLevel)) {
      return "course_prerequisite";
    }
  }
  if (
    input.actor !== "public" &&
    course.minimumAge &&
    diver?.dateOfBirth &&
    input.courseDate &&
    checkMinimumAge(diver.dateOfBirth, course.minimumAge, input.courseDate).status === "under"
  ) {
    return "course_min_age";
  }
  return null;
}

/**
 * The in-water ratio cap a staffed course session carries, after the boat's
 * own limits have passed. Null cap means the session carries no ratio and the
 * trip's capacity alone decides (`courseRatioKind`, `src/lib/course-ratios.ts`).
 */
export function courseRatioRefusal(
  seatsAboard: number,
  entryLevelSeatCap: number | null,
): "course_ratio_full" | null {
  return entryLevelSeatCap !== null && seatsAboard >= entryLevelSeatCap
    ? "course_ratio_full"
    : null;
}

/** How a booking attached itself to a person on something short of proof (H-20260724-one-person-per-email). */
export type IdentityClaim = { bookedAs: string; matchedBy: "shared_email" | "picked_name" };

/**
 * The three identity columns a booking row carries, for a fresh insert and a
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
  identityMatchedBy: IdentityClaim["matchedBy"] | null;
  heldEmergencyContactName: null;
  heldEmergencyContactPhone: null;
} {
  return {
    identityUnconfirmedAt: identityUnconfirmed ? now : null,
    identityBookedAs: identityUnconfirmed ? (claim?.bookedAs ?? null) : null,
    identityMatchedBy: identityUnconfirmed ? (claim?.matchedBy ?? null) : null,
    // A seat (re)written starts with no desk-recorded contact of its own
    // (issue #2145): one from an earlier hold on a reactivated row was about
    // whoever stood at the counter then.
    heldEmergencyContactName: null,
    heldEmergencyContactPhone: null,
  };
}
