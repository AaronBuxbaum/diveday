import type { Certification } from "@/db/schema";
import { checkMinimumAge } from "./age";
import type { BookingActor } from "./booking-gates";
import type { CalendarDate } from "./calendar-date";
import type { CertificationLevel } from "./certification-levels";
import { courseSeatCapacity } from "./course-ratios";
import { hasVerifiedCertificationAtLeast } from "./readiness";

/**
 * **Whether a course session may take this seat, as one pure decision**
 * (issue #2709). Every door that puts a seat on a course session reads the
 * rows under the trip lock and asks `decideCourseAdmission`: the sale
 * (`createBookingRecord`), a staff move (`moveBooking`), an undone removal
 * (`restoreBooking`) and an undone no-show (`undoBookingNoShow`). Nothing here
 * reads the database, so each gate is tested on its own rather than only
 * through a seeded booking.
 *
 * **Every door asks every gate** (issues #3769, #3686). An undo once asked the
 * ratio alone, on the reasoning that it repairs a misclick; but it is a
 * seat-granting write like any other, and between the release and the undo
 * the session can lose its last instructor, the student's card can be
 * revoked, or a date of birth can be recorded that the session's day finds too
 * young. What an undo still skips (the conditions hold, the departure-time
 * check) is the caller's, because it is about the trip, not the course.
 *
 * These decide who may *buy* (or get back) a seat. Who may board is
 * `calculateReadiness`, and admission may never refuse someone readiness
 * would clear (AGENTS.md): readiness asks the course's card and age too.
 */

/** Every way a course session refuses a seat. Codes, never sentences. */
export type CourseAdmissionRefusal =
  /**
   * No instructor is rostered on the session. Asked of everyone aboard,
   * student or passenger: a priced rider on an unstaffed session is still a
   * seat on a session nobody is teaching.
   */
  | "course_unstaffed"
  /** The course's prerequisite card is not on file, verified. */
  | "course_prerequisite"
  /** Too young for the course on the day that session runs. */
  | "course_min_age"
  /** The crew's in-water ratio is already full of students. */
  | "course_ratio_full";

/** The part of a course row the gates read. */
export type CourseAdmissionRule = {
  agency: string;
  isIntroCourse: boolean;
  minimumCertificationLevel: CertificationLevel | null;
  minimumAge: number | null;
};

/** The session's rostered crew, as `countInWaterCrew` counts it. */
export type CourseCrew = { instructorCount: number; assistantCount: number };

/** What the enrollment gates know about the student. */
export type CourseDiver = { cards: readonly Certification[]; dateOfBirth: CalendarDate | null };

export type CourseAdmissionInput = {
  /** Null when the departure is no course session (or its course row is gone). */
  course: CourseAdmissionRule | null;
  /**
   * Whether this seat is a student's: a diver's (issue #2226). A snorkeler or
   * a rider beside the class is asked none of the enrollment gates and is
   * counted against none of the ratio.
   */
  student: boolean;
  crew: CourseCrew;
  /** Students already holding a seat on the session, this one excluded. */
  studentsHeld: number;
  actor: BookingActor;
  /** Null when the booking has no person row yet (a walk-in, written later). */
  diver: CourseDiver | null;
  /** The course day in the shop's calendar; needed only for the age gate. */
  courseDate: CalendarDate | null;
};

/**
 * The course session's answer for one seat, in the order the gates apply:
 * staffing, then the card, then age, then the ratio. Null admits.
 *
 * The boat's own limits (`seatRefusal`) are the caller's, asked before this:
 * a full boat is refused as full, a cheaper answer that says nothing about
 * the diver.
 */
export function decideCourseAdmission(input: CourseAdmissionInput): CourseAdmissionRefusal | null {
  const { course } = input;
  if (!course) return null;
  if (input.crew.instructorCount <= 0) return "course_unstaffed";
  if (!input.student) return null;
  const refusal = courseEnrollmentRefusal({
    actor: input.actor,
    course,
    diver: input.diver,
    courseDate: input.courseDate,
  });
  if (refusal) return refusal;
  const cap = courseSeatCapacity(course, input.crew.instructorCount, input.crew.assistantCount);
  return courseRatioRefusal(input.studentsHeld, cap);
}

/**
 * **How many students this session's crew may seat**, the measure the wait
 * list and the roll read (issue #2679): null when the departure is no course
 * session or its course carries no ratio, 0 when no instructor is rostered
 * (the sale refuses `course_unstaffed`), otherwise `courseSeatCapacity`.
 */
export function courseStudentCap(
  course: CourseAdmissionRule | null,
  crew: CourseCrew,
): number | null {
  if (!course) return null;
  if (crew.instructorCount <= 0) return 0;
  return courseSeatCapacity(course, crew.instructorCount, crew.assistantCount);
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
  diver: CourseDiver | null;
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
 * The in-water ratio cap a course session carries, after the boat's own
 * limits have passed. Null cap means the session carries no ratio and the
 * trip's capacity alone decides (`courseRatioKind`, `src/lib/course-ratios.ts`).
 */
export function courseRatioRefusal(
  studentsHeld: number,
  studentSeatCap: number | null,
): "course_ratio_full" | null {
  return studentSeatCap !== null && studentsHeld >= studentSeatCap ? "course_ratio_full" : null;
}
