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
 * (`restoreBooking`) and an undone no-show (`undoNoShow`). Nothing here reads
 * the database, so each gate is tested on its own rather than only through a
 * seeded booking, and a new gate is a row in {@link COURSE_GATES}, never a new
 * branch in a transaction.
 *
 * These decide who may *buy* (or get back) a seat. Who may board is
 * `calculateReadiness`, and admission may never refuse someone readiness
 * would clear (AGENTS.md).
 */

/** Every way a course session refuses a seat. Codes, never sentences. */
export type CourseAdmissionRefusal =
  /** No instructor is rostered on the session. */
  | "course_unstaffed"
  /** The course's prerequisite card is not on file, verified. */
  | "course_prerequisite"
  /** Too young for the course on the day that session runs. */
  | "course_min_age"
  /** The crew's in-water ratio is already full of students. */
  | "course_ratio_full";

/** The only refusal an undo can meet: the restore row of {@link COURSE_GATES}. */
export type CourseRestoreRefusal = "course_ratio_full";

/**
 * How strictly a door asks. `sale` puts a seat on the session that was not
 * there: a new booking and a staff move alike, because a moved seat is
 * measured exactly as a new staff seat is (ADR 20261013-staff-move-a-seat).
 * `restore` hands back a seat the session already sold, after a misclick.
 */
export type CourseAdmissionStrictness = "sale" | "restore";

/**
 * **Which gates each strictness asks.** The one place the difference between
 * a sale and an undo is written down.
 *
 * - **staffing**: a course session is unsafe to market as open until an
 *   instructor is on it. Asked of everyone aboard, student or passenger: a
 *   priced rider on an unstaffed session is still a seat sold on a session
 *   nobody is teaching.
 * - **enrollment**: the course's card and age gates, the student's alone.
 *   Not asked again on an undo: the diver passed them when the seat was sold,
 *   and an undo puts back a clerical slip, not a new enrollment.
 * - **ratio**: the crew's in-water cap on students. Asked by every door,
 *   because an undo is a seat-granting write like any other: remove a diver
 *   from a four-seat DSD, let a walk-up take the freed seat, and an
 *   unchecked Undo would put a fifth first-timer with one instructor.
 */
export const COURSE_GATES: Record<
  CourseAdmissionStrictness,
  { staffing: boolean; enrollment: boolean; ratio: boolean }
> = {
  sale: { staffing: true, enrollment: true, ratio: true },
  restore: { staffing: false, enrollment: false, ratio: true },
};

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

type CourseAdmissionCommon = {
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
};

export type CourseRestoreInput = CourseAdmissionCommon & { strictness: "restore" };
export type CourseSaleInput = CourseAdmissionCommon & {
  strictness: "sale";
  actor: BookingActor;
  /** Null when the booking has no person row yet (a walk-in, written later). */
  diver: CourseDiver | null;
  /** The course day in the shop's calendar; needed only for the age gate. */
  courseDate: CalendarDate | null;
};
export type CourseAdmissionInput = CourseRestoreInput | CourseSaleInput;

/**
 * The course session's answer for one seat, in the order the gates apply:
 * staffing, then the card, then age, then the ratio. Null admits.
 *
 * The boat's own limits (`seatRefusal`) are the caller's, asked before this:
 * a full boat is refused as full, a cheaper answer that says nothing about
 * the diver.
 */
export function decideCourseAdmission(input: CourseRestoreInput): CourseRestoreRefusal | null;
export function decideCourseAdmission(input: CourseSaleInput): CourseAdmissionRefusal | null;
export function decideCourseAdmission(input: CourseAdmissionInput): CourseAdmissionRefusal | null;
export function decideCourseAdmission(input: CourseAdmissionInput): CourseAdmissionRefusal | null {
  const { course } = input;
  if (!course) return null;
  const gates = COURSE_GATES[input.strictness];
  if (gates.staffing && input.crew.instructorCount <= 0) return "course_unstaffed";
  if (!input.student) return null;
  if (gates.enrollment && input.strictness === "sale") {
    const refusal = courseEnrollmentRefusal({
      actor: input.actor,
      course,
      diver: input.diver,
      courseDate: input.courseDate,
    });
    if (refusal) return refusal;
  }
  if (gates.ratio) {
    const cap = courseSeatCapacity(course, input.crew.instructorCount, input.crew.assistantCount);
    return courseRatioRefusal(input.studentsHeld, cap);
  }
  return null;
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
