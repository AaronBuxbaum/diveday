/** The shape of an in-water ratio: a base, an assistant bonus, and a ceiling. */
export type CourseRatioRule = {
  /** Students one instructor may supervise before any assistant is counted. */
  baseStudentsPerInstructor: number;
  /** Extra students each certified assistant (a Divemaster) adds. Zero means assistants buy nothing. */
  assistantBonusPerInstructor: number;
  /** Hard per-instructor ceiling, whatever the assistant count. */
  maxStudentsPerInstructor: number;
};

/**
 * PADI's published in-water ratio for Open Water Diver open-water training
 * dives: up to 8 students per instructor, extendable by 2 per certified
 * assistant (a Divemaster aboard, in DiveDay's role model) to a hard ceiling of
 * 12 — see H-08 (docs/product/human-decisions.md) and
 * docs/architecture/decisions/20260724-course-admission-standards.md for the
 * PADI/SSI sourcing. Continuing-education courses (Advanced Open Water,
 * Rescue, specialties) are not modeled here — they already require a verified
 * card at booking (`courses.minimumCertificationLevel`) and PADI does not
 * publish a comparably strict numeric ratio for them.
 *
 * This is *not* the DSD number. Discover Scuba Diving is a stricter, separate
 * standard — see `INTRO_COURSE_RATIO`.
 */
export const ENTRY_LEVEL_COURSE_RATIO: CourseRatioRule = {
  baseStudentsPerInstructor: 8,
  assistantBonusPerInstructor: 2,
  maxStudentsPerInstructor: 12,
};

/**
 * The ratio for a no-certification-required taster session (Discover Scuba
 * Diving, Try Scuba — `courses.is_intro_course`): **4 students per instructor,
 * with no assistant bonus at all**. These are uncertified people breathing
 * compressed gas for the first time, so the crew cannot buy extra seats.
 *
 * **This 4:1 figure is INTERIM and UNVERIFIED.** It is a deliberately
 * conservative placeholder, not a sourced standard: the 8/12 numbers above came
 * from a blog rather than an agency manual, and applying them to DSD was
 * certifying an overloaded session as compliant. HD-6 (obtain the current PADI
 * Instructor Manual DSD ratio from a PADI professional — see
 * docs/product/human-decisions.md, H-08) is the decision that unblocks
 * replacing this with a cited number. Until then the gate errs tight; do not
 * describe it as verified, and do not loosen it without that source.
 */
export const INTRO_COURSE_RATIO: CourseRatioRule = {
  baseStudentsPerInstructor: 4,
  assistantBonusPerInstructor: 0,
  maxStudentsPerInstructor: 4,
};

/**
 * How many students a session may seat under `rule` given the instructors and
 * certified assistants (Divemasters) actually assigned as crew. Deliberately
 * conservative: caps at the per-instructor ceiling regardless of assistant
 * count, and a session with no instructor seats nobody — that's the existing
 * `course_unstaffed` gate's job, not this one's.
 */
export function courseRatioCapacity(
  rule: CourseRatioRule,
  instructorCount: number,
  assistantCount: number,
): number {
  if (instructorCount <= 0) return 0;
  const uncapped =
    instructorCount * rule.baseStudentsPerInstructor +
    assistantCount * rule.assistantBonusPerInstructor;
  return Math.min(uncapped, instructorCount * rule.maxStudentsPerInstructor);
}

/** Seats an Open Water training session may take. Shorthand for `ENTRY_LEVEL_COURSE_RATIO`. */
export function entryLevelCourseCapacity(instructorCount: number, assistantCount: number): number {
  return courseRatioCapacity(ENTRY_LEVEL_COURSE_RATIO, instructorCount, assistantCount);
}

/**
 * The subset of a course row the ratio rules need — narrower than the full
 * `courses` row so every caller (a joined query, a form field, a test fixture)
 * can pass its own shape without importing the schema type.
 */
export type CourseCrewGapCourse = {
  agency: string;
  minimumCertificationLevel: string | null;
  /** `courses.is_intro_course` — a DSD/Try Scuba taster, gated far tighter. */
  isIntroCourse: boolean;
} | null;

/**
 * `courses.agency` is plain shop-set text, so `"PADI"`, `" padi"`, and `"padi"`
 * are the same agency and a stray capital must never silently drop a safety
 * cap. Compare only through this.
 */
function normalizeAgency(agency: string): string {
  return agency.trim().toLowerCase();
}

/**
 * The one definition of "is this session ratio-gated, and at what ratio" —
 * null when it isn't gated at all. Every enforcing and advisory caller reads
 * this rather than re-deriving the predicate, because three inline copies of it
 * is exactly how the DSD case drifted out of the gate in the first place.
 *
 * - An **intro session** (`is_intro_course`) is gated at `INTRO_COURSE_RATIO`
 *   whatever else the row says: nobody on it holds a card, so a
 *   `minimum_certification_level` typed onto it by mistake must not be able to
 *   switch the cap off.
 * - A **non-intro entry-level** session (no `minimum_certification_level` — the
 *   Open Water training dives) is gated at `ENTRY_LEVEL_COURSE_RATIO`.
 * - Everything else is ungated: continuing-education courses already require a
 *   verified card at booking and PADI publishes no comparable numeric ratio.
 *
 * Scoped to PADI throughout, because the sourced figures are PADI's and
 * `courses.agency` is free text an SSI/NAUI course legitimately fills in —
 * applying a PADI number to another agency's course would be a
 * wrong-but-confident safety control.
 */
export function courseRatioRule(course: CourseCrewGapCourse): CourseRatioRule | null {
  if (!course) return null;
  if (normalizeAgency(course.agency) !== "padi") return null;
  if (course.isIntroCourse) return INTRO_COURSE_RATIO;
  if (course.minimumCertificationLevel) return null;
  return ENTRY_LEVEL_COURSE_RATIO;
}

/**
 * How many students this course session's assigned crew may seat, or null when
 * the session carries no ratio cap at all (so the trip's own capacity is the
 * only limit, exactly as before this gate existed).
 */
export function courseSeatCapacity(
  course: CourseCrewGapCourse,
  instructorCount: number,
  assistantCount: number,
): number | null {
  const rule = courseRatioRule(course);
  if (!rule) return null;
  return courseRatioCapacity(rule, instructorCount, assistantCount);
}

/**
 * Whether — and why — a course session's assigned crew falls short of what
 * the session needs, and how far. A trip with no course never has a gap: this
 * is entirely about the crew a *course* session needs to run at all.
 *
 * - `no_instructor`: the session has zero instructors assigned. Blocks
 *   enrolment outright (`reviewManifestChange`) — every agency, not just PADI.
 * - `over_ratio`: a ratio-gated session (see `courseRatioRule`) has at least
 *   one instructor, but the crew's ratio capacity has fallen below the trip's
 *   booked count — day-of crew changes are unblocked (H-14), so this can drift
 *   after booking. A nudge to fix before sailing, never a retroactive block on
 *   the bookings already taken.
 * - `none`: adequately crewed, or not a ratio-gated session.
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
  const capacity = courseSeatCapacity(input.course, input.instructorCount, input.assistantCount);
  if (capacity === null) return { code: "none" };
  if (input.booked > capacity) return { code: "over_ratio", booked: input.booked, capacity };
  return { code: "none" };
}

/** True whenever `courseCrewGap` found anything worth surfacing to staff. */
export function hasCourseCrewGap(gap: CourseCrewGap): boolean {
  return gap.code !== "none";
}
