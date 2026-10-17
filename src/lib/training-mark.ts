import type { ParticipantType } from "./participant-types";
import { isDiver } from "./participant-types";

/**
 * **A training mark** (issue #2275, ADR
 * 20261012-course-forms-on-charters-and-counter): staff said a seat on an
 * ordinary departure carries a training dive for one of the diver's course
 * seats (the enrollment). The seat is then asked that course's forms.
 *
 * This module is the one answer to "does this mark still stand?". The writer
 * asks it before it stores a mark and every reader asks it again, so a mark
 * that stopped being true (the enrollment canceled, its session moved, the
 * diver merged away) is never read as one. A mark that does not stand is
 * never read as "no mark" either: boarding raises `training_mark_invalid`
 * until a staffer clears it.
 */

/** The marked seat, as the rule reads it. */
export type TrainingMarkSeat = {
  personId: string;
  participantType: ParticipantType;
  /** The seat's own departure is a course session (`trips.course_id` set). */
  onCourseSession: boolean;
  departureStartsAt: Date;
};

/**
 * The course seat the mark names, read under the seat's own shop. Null when no
 * such live booking exists at that shop: another shop's id, a deleted
 * departure, or a row that is gone.
 */
export type TrainingMarkEnrollment = {
  personId: string;
  status: "booked" | "checked_in" | "no_show" | "cancelled";
  identityHeld: boolean;
  participantType: ParticipantType;
  courseId: string | null;
  departureCanceled: boolean;
  sessionEndsAt: Date;
};

export type TrainingMarkProblem =
  /** The seat is itself on a course session: it is the enrollment, not a training dive. */
  | "seat_on_course_session"
  /** A snorkeler or a rider does not dive, so carries no training dive. */
  | "seat_not_diving"
  | "enrollment_missing"
  | "enrollment_other_person"
  | "enrollment_canceled"
  /** The enrollment is held for staff to confirm who it is (H-13). */
  | "enrollment_held"
  | "enrollment_not_diving"
  | "not_a_course_session"
  /** The session ends before this departure leaves: the dive is not part of it. */
  | "ends_before_departure";

/**
 * Whether a mark from `seat` to `enrollment` stands, or the first reason it
 * does not. Boring on purpose: one check per line, every one of them a
 * refusal, and nothing here ever reads the clock — a mark is not undone by
 * time passing, only by a fact changing.
 */
export function trainingMarkProblem(
  seat: TrainingMarkSeat,
  enrollment: TrainingMarkEnrollment | null,
): TrainingMarkProblem | null {
  if (seat.onCourseSession) return "seat_on_course_session";
  if (!isDiver(seat.participantType)) return "seat_not_diving";
  if (!enrollment) return "enrollment_missing";
  if (enrollment.personId !== seat.personId) return "enrollment_other_person";
  if (enrollment.status === "cancelled" || enrollment.departureCanceled) {
    return "enrollment_canceled";
  }
  if (enrollment.identityHeld) return "enrollment_held";
  if (!isDiver(enrollment.participantType)) return "enrollment_not_diving";
  if (enrollment.courseId === null) return "not_a_course_session";
  if (enrollment.sessionEndsAt.getTime() < seat.departureStartsAt.getTime()) {
    return "ends_before_departure";
  }
  return null;
}

/**
 * What a reader knows about one marked seat: the enrollment whose forms it is
 * asked, or that the mark no longer stands.
 */
export type TrainingMarkState =
  | {
      valid: true;
      enrollmentBookingId: string;
      enrollmentTripId: string;
      /**
       * The course seat's "Under 18". A reader of the charter seat ORs it with
       * the charter's own, so both seats ask the guardian the same way.
       */
      enrollmentMinorDeclared: boolean;
    }
  | { valid: false; problem: TrainingMarkProblem };
