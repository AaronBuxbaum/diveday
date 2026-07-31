/**
 * PADI's published in-water ratio for an entry-level, no-card-required session
 * (Discover Scuba Diving, Open Water Diver open-water training dives): up to 8
 * students per instructor, extendable by 2 per certified assistant (a
 * Divemaster aboard, in DiveDay's role model) to a hard ceiling of 12 — see
 * H-08 (docs/product/human-decisions.md) and
 * docs/architecture/decisions/20260724-course-admission-standards.md for the
 * PADI/SSI sourcing. Continuing-education courses (Advanced Open Water,
 * Rescue, specialties) are not modeled here — they already require a verified
 * card at booking (`courses.minimumCertificationLevel`) and PADI does not
 * publish a comparably strict numeric ratio for them.
 */
export const ENTRY_LEVEL_COURSE_RATIO = {
  baseStudentsPerInstructor: 8,
  assistantBonusPerInstructor: 2,
  maxStudentsPerInstructor: 12,
} as const;

/**
 * How many students an entry-level (DSD/Open Water) session may seat given the
 * instructors and certified assistants (Divemasters) actually assigned as
 * crew. Deliberately conservative: caps at the per-instructor ceiling
 * regardless of assistant count, and a session with no instructor seats
 * nobody — that's the existing `course_unstaffed` gate's job, not this one's.
 */
export function entryLevelCourseCapacity(instructorCount: number, assistantCount: number): number {
  if (instructorCount <= 0) return 0;
  const { baseStudentsPerInstructor, assistantBonusPerInstructor, maxStudentsPerInstructor } =
    ENTRY_LEVEL_COURSE_RATIO;
  const uncapped =
    instructorCount * baseStudentsPerInstructor + assistantCount * assistantBonusPerInstructor;
  return Math.min(uncapped, instructorCount * maxStudentsPerInstructor);
}

/**
 * The subset of a course row `courseCrewGap` needs — narrower than the full
 * `courses` row so every caller (a joined query, a form field, a test fixture)
 * can pass its own shape without importing the schema type.
 */
export type CourseCrewGapCourse = {
  agency: string;
  minimumCertificationLevel: string | null;
} | null;

/**
 * Whether — and why — a course session's assigned crew falls short of what
 * the session needs, and how far. A trip with no course never has a gap: this
 * is entirely about the crew a *course* session needs to run at all.
 *
 * - `no_instructor`: the session has zero instructors assigned. Blocks
 *   enrolment outright (`reviewManifestChange`) — every agency, not just PADI.
 * - `over_ratio`: an entry-level PADI session (no `minimumCertificationLevel`
 *   gate — Advanced/Rescue/specialties already gate on a verified card at
 *   booking and PADI publishes no comparable ratio for them) has at least one
 *   instructor, but the crew's ratio capacity
 *   (`entryLevelCourseCapacity`) has fallen below the trip's booked count —
 *   day-of crew changes are unblocked (H-14), so this can drift after
 *   booking. A nudge to fix before sailing, never a retroactive block on the
 *   bookings already taken.
 * - `none`: adequately crewed, or not a course session.
 */
export type CourseCrewGap =
  | { code: "none" }
  | { code: "no_instructor" }
  | { code: "over_ratio"; booked: number; capacity: number };

/**
 * The one computation of "does this course session have enough crew",
 * consumed by the trip page, the staffing coverage list, and the Today queue
 * (docs/product/archive/ux-personas-20260730-findings.md, Lens 17 task 151) so the
 * three surfaces can no longer disagree about the same trip.
 */
export function courseCrewGap(input: {
  course: CourseCrewGapCourse;
  instructorCount: number;
  assistantCount: number;
  booked: number;
}): CourseCrewGap {
  if (!input.course) return { code: "none" };
  if (input.instructorCount <= 0) return { code: "no_instructor" };
  const isEntryLevelGated =
    input.course.agency === "padi" && !input.course.minimumCertificationLevel;
  if (!isEntryLevelGated) return { code: "none" };
  const capacity = entryLevelCourseCapacity(input.instructorCount, input.assistantCount);
  if (input.booked > capacity) return { code: "over_ratio", booked: input.booked, capacity };
  return { code: "none" };
}

/** True whenever `courseCrewGap` found anything worth surfacing to staff. */
export function hasCourseCrewGap(gap: CourseCrewGap): boolean {
  return gap.code !== "none";
}
