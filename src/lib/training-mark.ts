import type { CertificationLevel } from "./certification-levels";
import { type CourseRatioRule, courseRatioCapacity } from "./course-ratios";
import { countInWaterCrew, inWaterCrewRole, type TripCrewAssignment } from "./crew-roles";
import type { ParticipantType } from "./participant-types";
import { isDiver } from "./participant-types";
import { type Requirement, requirementDemandsNothing } from "./requirement";

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
      /** The course the dive counts toward, as the manifest names it. */
      enrollmentCourseTitle: string;
      /**
       * What the course says about levels, or `undefined` when the course row
       * could not be read: then the seat never takes the course's level
       * (issue #2731), it keeps the charter's.
       */
      enrollmentCourse: TrainingDiveCourse | undefined;
      /**
       * An instructor of the enrollment's session is aboard this seat's
       * departure for it (issue #2731; review 2026-10-17): rostered as the
       * instructor on both by someone else, not counted off the boat at the
       * crew count, and this seat within the course ratio of those aboard.
       */
      courseInstructorAboard: boolean;
      /**
       * An instructor of the course is aboard but this seat does not fit under
       * the tightest ratio on them: the seat keeps the departure's level and
       * the manifest says so, not "no instructor aboard".
       */
      overRatio?: boolean;
    }
  | { valid: false; problem: TrainingMarkProblem };

/** One person on a departure's crew, as `groupCrewAssignments` folds them. */
export type CrewMember = TripCrewAssignment & { personId: string };

/**
 * **The course's instructors aboard** (issue #2731): the people who count as
 * the instructor in the water on the enrollment's session and on this
 * departure too, read the way the session's own ratio reads them
 * (`inWaterCrewRole`). A captain, a deckhand or a divemaster slot does not
 * count on either side, nor does an instructor of some other course. The
 * caller hands in only crew it can trust (review 2026-10-17): rostered by
 * someone else, and not counted off the boat at the departure's crew count.
 */
export function courseInstructorsAboard(
  sessionCrew: readonly CrewMember[],
  departureCrew: readonly CrewMember[],
): number {
  return courseInstructorIdsAboard(sessionCrew, departureCrew).length;
}

/** Who `courseInstructorsAboard` counts, by person. */
export function courseInstructorIdsAboard(
  sessionCrew: readonly CrewMember[],
  departureCrew: readonly CrewMember[],
): string[] {
  const teaches = new Set(
    sessionCrew
      .filter((member) => inWaterCrewRole(member) === "instructor")
      .map((member) => member.personId),
  );
  return departureCrew
    .filter((member) => teaches.has(member.personId) && inWaterCrewRole(member) === "instructor")
    .map((member) => member.personId);
}

/** A marked seat or a candidate for the room: its session, and the ratio of that course, if any. */
export type TrainingRoomSeat = {
  id: string;
  sessionTripId: string;
  /** Null when the course has no ratio we know: the seat is never seated (fail closed). */
  rule: CourseRatioRule | null;
};

/**
 * **Who a departure's instructors can supervise as training dives** (review
 * 2026-10-17). The marked seats of every course session on one departure share
 * the same instructors, so each instructor's load is counted across sessions,
 * never per session. Seats are taken oldest mark first; each goes to an
 * instructor aboard for its session who still has room under its course's
 * ratio, and an instructor's new load must also fit the tightest ratio of every seat already on them (a DSD seat caps later Open Water seats at the DSD ratio). A certified assistant aboard the departure raises the cap, as it does
 * on the session itself (`countInWaterCrew`), shared out evenly and rounded
 * down: it may seat fewer than the session would, never more. A seat whose
 * course has no known ratio is never seated. Nor can another seat be covered
 * on that departure: the actual in-water groups and instructor loads are unknown.
 */
function seatTrainingRoom(
  seats: readonly TrainingRoomSeat[],
  sessionCrew: ReadonlyMap<string, readonly CrewMember[]>,
  departureCrew: readonly CrewMember[],
): { seated: Set<string>; overRatio: Set<string> } {
  // Session rosters do not establish who dives together or which instructor
  // takes an unmodeled seat. No modeled coverage can be proved on this departure.
  if (seats.some((seat) => seat.rule === null)) {
    return { seated: new Set(), overRatio: new Set() };
  }
  const aboardFor = (sessionTripId: string) =>
    courseInstructorIdsAboard(sessionCrew.get(sessionTripId) ?? [], departureCrew);
  const instructors = new Set(seats.flatMap((seat) => aboardFor(seat.sessionTripId)));
  const { assistantCount } = countInWaterCrew(departureCrew);
  const load = new Map<string, number>();
  // The tightest cap among the seats already on each instructor: a taker's new load must fit it too.
  //
  // **Deliberate, not an accident of the arithmetic** (issue #2830, Aaron
  // 2026-10-22). A DSD seat caps the same instructor's Open Water seats at the
  // DSD ratio, although the DSD seat lowers no level and the published DSD
  // figure is written for DSD participants. Seats assigned to one instructor
  // may form one group in the water at once, and a DSD participant
  // may never have breathed from a regulator in open water: the instructor has to
  // stay within reach of them for the whole dive, so the Open Water students
  // beside them get the attention a DSD group leaves over, not the attention a
  // dedicated Open Water ratio assumes. No standard we hold (HD-6) says a mixed
  // group may be counted as two ratios, and counting it that way is the
  // over-ratio direction. The cost is seats on mixed days; the shop's answer is
  // a second instructor for one group. An assistant does not lift it, because
  // the DSD ratio credits none (`INTRO_COURSE_RATIO`). Pinned in
  // `training-mark.test.ts` ("caps later Open Water seats at the DSD ratio").
  const tightest = new Map<string, number>();
  const seated = new Set<string>();
  const overRatio = new Set<string>();
  for (const seat of seats) {
    if (!seat.rule || instructors.size === 0) continue;
    const cap = Math.floor(
      courseRatioCapacity(seat.rule, instructors.size, assistantCount) / instructors.size,
    );
    const taker = aboardFor(seat.sessionTripId).find((personId) => {
      const newLoad = (load.get(personId) ?? 0) + 1;
      return newLoad <= Math.min(cap, tightest.get(personId) ?? cap);
    });
    if (taker === undefined) {
      if (aboardFor(seat.sessionTripId).length > 0) overRatio.add(seat.id);
      continue;
    }
    load.set(taker, (load.get(taker) ?? 0) + 1);
    tightest.set(taker, Math.min(cap, tightest.get(taker) ?? cap));
    seated.add(seat.id);
  }
  return { seated, overRatio };
}

/**
 * The marked seats of one departure within the room its instructors have, and
 * (with a `candidate`) whether one more seat of that course would fit without
 * unseating a seat already marked.
 */
export function trainingRoom(input: {
  marked: readonly TrainingRoomSeat[];
  candidate?: TrainingRoomSeat;
  sessionCrew: ReadonlyMap<string, readonly CrewMember[]>;
  departureCrew: readonly CrewMember[];
}): { seated: ReadonlySet<string>; overRatio: ReadonlySet<string>; spare: boolean } {
  const { marked, candidate, sessionCrew, departureCrew } = input;
  const { seated, overRatio } = seatTrainingRoom(marked, sessionCrew, departureCrew);
  if (!candidate) return { seated, overRatio, spare: false };
  const withCandidate = seatTrainingRoom([...marked, candidate], sessionCrew, departureCrew).seated;
  const spare =
    withCandidate.has(candidate.id) &&
    marked.every((seat) => withCandidate.has(seat.id) === seated.has(seat.id));
  return { seated, overRatio, spare };
}

/** A conditional depth prompt, not a claim about underwater groups or clearance. */
export function mixedTrainingDepthAdvisory(courses: readonly { intro?: boolean }[]): boolean {
  // Saved manifests from before course type was carried have unknown kinds.
  // Two distinct marked seats may still be mixed, so ask rather than imply clearance.
  return courses.some(
    (course, index) =>
      course.intro !== false &&
      courses.some((other, otherIndex) => otherIndex !== index && other.intro !== true),
  );
}

/** The ladder's order, as `certificationRank` (./readiness.ts) reads it; kept here so this module imports no gate. */
const RANK: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};
const certificationRank = (level: CertificationLevel) => RANK[level];

/** What a course says about levels, for a marked training dive (issue #2731). */
export type TrainingDiveCourse = {
  /** `courses.minimum_certification_level`: what a student must hold to start it. */
  minimumLevel: CertificationLevel | null;
  /** `courses.certifies_level`: the card it trains toward; null for none. */
  certifiesLevel: CertificationLevel | null;
  /** `courses.is_intro_course`: a Discover Scuba taster. */
  intro: boolean;
};

/**
 * **The level a training dive on this course answers to** (issue #2731;
 * domain review 2026-10-17). The departure's and its sites' level is lowered
 * only as far as the course reaches: when that level is at or below the card
 * the course certifies, the course's own minimum stands in its place, and a
 * course with no minimum (an Open Water course) asks no card for a level it
 * certifies. Otherwise, and always for an intro session or a course that
 * certifies no level, the departure's level stands: the gate is lowered,
 * never raised. Whether the course has a known ratio is not asked here; a seat
 * of a course without one is never "within the room" (`trainingRoom`), so
 * `trainingDiveLevel` never hands it in.
 */
export function trainingDiveRequiredLevel(
  required: CertificationLevel | null,
  course: TrainingDiveCourse,
): CertificationLevel | null {
  if (!required || course.intro || !course.certifiesLevel) return required;
  if (certificationRank(required) > certificationRank(course.certifiesLevel)) return required;
  if (!course.minimumLevel) return null;
  return certificationRank(course.minimumLevel) < certificationRank(required)
    ? course.minimumLevel
    : required;
}

/**
 * Whether a marked training dive asks the diver for no card at all where the
 * departure asks for `required`: the lowering reached nothing, so the card
 * line must not say a card is "on file" (review 2026-10-18).
 */
export function trainingDiveAsksNoCard(
  required: Requirement,
  course: TrainingDiveCourse | null,
): boolean {
  // A nitrox or specialty card is still asked: only the level is ever lowered.
  if (required.requiresNitrox || required.requiredSpecialties.length > 0) return false;
  const level = required.minimumCertificationLevel;
  return level !== null && course !== null && trainingDiveRequiredLevel(level, course) === null;
}

/** The no-card wording is valid only when the trip itself asks for no card. */
export function trainingDiveAsksNoCardForSite(
  trip: Requirement | null | undefined,
  site: Requirement | null | undefined,
  course: TrainingDiveCourse | null,
): boolean {
  return requirementDemandsNothing(trip) && !!site && trainingDiveAsksNoCard(site, course);
}

/**
 * The course a marked training dive answers to (issue #2731, decided by
 * Aaron 2026-10-17): with the mark standing, the course readable and its
 * instructor aboard for this seat; otherwise null, and the departure's level
 * stands. Only the level: a site's specialty or nitrox gate is unchanged.
 */
export function trainingDiveLevel(mark: TrainingMarkState | undefined): TrainingDiveCourse | null {
  if (!mark?.valid || !mark.courseInstructorAboard) return null;
  return mark.enrollmentCourse ?? null;
}
