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
 * assistant (a Divemaster aboard, in DiveDay's role model) to a hard ceiling
 * of 12 — see H-08 (docs/product/human-decisions.md) and
 * docs/architecture/decisions/20260724-course-admission-standards.md for the
 * PADI/SSI sourcing. Continuing-education courses (Advanced Open Water,
 * Rescue, specialties) are not modeled here — they already require a verified
 * card at booking (`courses.minimumCertificationLevel`) and PADI does not
 * publish a comparably strict numeric ratio for them.
 *
 * Discover Scuba Diving (DSD) is a *different, tighter* PADI ratio — see
 * {@link DSD_RATIO} — because DSD participants have had zero prior water
 * time, unlike an Open Water student who has already completed confined
 * dives. The two were previously conflated (this constant applied to both),
 * which overstated DSD capacity; HD-6 (docs/product/human-decisions.md, H-08
 * reopened) obtained the real PADI Instructor Manual figures and split them.
 */
export const ENTRY_LEVEL_COURSE_RATIO: CourseRatioRule = {
  baseStudentsPerInstructor: 8,
  assistantBonusPerInstructor: 2,
  maxStudentsPerInstructor: 12,
};

/**
 * PADI's published Discover Scuba Diving ratio, from the Instructor Manual
 * (HD-6, sourced 2026-08-02): 4 students per instructor in confined/pool
 * water, tightening to 2 students per instructor for the open-water dive.
 * DiveDay's trip model has no confined-water session type — a trip is one
 * dated open-water outing (see
 * docs/architecture/decisions/20260724-course-admission-standards.md,
 * "Alternatives considered") — so only the tighter open-water figure is
 * enforced against a booked DSD session (via {@link INTRO_COURSE_RATIO}); the
 * confined-water number is recorded here for completeness, unenforced.
 * No published assistant bonus for DSD, so none is credited here.
 */
export const DSD_RATIO = {
  confinedWaterStudentsPerInstructor: 4,
  openWaterStudentsPerInstructor: 2,
} as const;

/**
 * The ratio for a no-certification-required taster session (Discover Scuba
 * Diving, Try Scuba — `courses.is_intro_course`): the Instructor Manual's
 * **open-water DSD figure, with no assistant bonus at all**. These are
 * uncertified people breathing compressed gas for the first time, so the crew
 * cannot buy extra seats.
 *
 * Derived from {@link DSD_RATIO} rather than restating the number, so the one
 * sourced figure (HD-6) cannot drift out of step with the rule that enforces
 * it. Expressed as a {@link CourseRatioRule} so intro and entry-level sessions
 * flow through the same `courseRatioCapacity` arithmetic.
 *
 * The DSD *rationale* — participants who have had zero prior water time — does
 * not depend on whose logo is on the course, so this cap is
 * **agency-independent**: an SSI Try Scuba and a NAUI intro session take it
 * exactly as a PADI DSD does. Only the sourced 8/+2/12 entry-level figure above
 * is PADI-scoped, because that one is a cited PADI number.
 */
export const INTRO_COURSE_RATIO: CourseRatioRule = {
  baseStudentsPerInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
  assistantBonusPerInstructor: 0,
  maxStudentsPerInstructor: DSD_RATIO.openWaterStudentsPerInstructor,
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

/**
 * How many students an entry-level (DSD/Open Water) session may seat given the
 * instructors and certified assistants (Divemasters) actually assigned as crew.
 * `isIntroCourse` (DSD) uses the tighter {@link INTRO_COURSE_RATIO} — the
 * Instructor Manual's open-water DSD figure — with no assistant bonus; every
 * other entry-level course uses {@link ENTRY_LEVEL_COURSE_RATIO}.
 *
 * Prefer `courseSeatCapacity`, which reads the course row and decides *whether*
 * a ratio applies at all. This is the arithmetic underneath it.
 */
export function entryLevelCourseCapacity(
  instructorCount: number,
  assistantCount: number,
  isIntroCourse = false,
): number {
  return courseRatioCapacity(
    isIntroCourse ? INTRO_COURSE_RATIO : ENTRY_LEVEL_COURSE_RATIO,
    instructorCount,
    assistantCount,
  );
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

/** Which of the two ratios a session carries, for callers that must word it differently. */
export type CourseRatioKind = "intro" | "entry_level";

/**
 * The one definition of "is this session ratio-gated, and under which rule" —
 * null when it isn't gated at all. Every enforcing and advisory caller reads
 * this (or `courseRatioRule`/`courseSeatCapacity` on top of it) rather than
 * re-deriving the predicate, because three inline copies of it is exactly how
 * the DSD case drifted out of the gate in the first place.
 *
 * - An **intro session** (`is_intro_course`) is gated at `INTRO_COURSE_RATIO`
 *   whatever else the row says: nobody on it holds a card, so a
 *   `minimum_certification_level` typed onto it by mistake must not be able to
 *   switch the cap off. **Every agency, not just PADI** — the reason the DSD
 *   figure is tighter is that intro participants have had zero water time, and
 *   that rationale does not depend on whose logo is on the course. Scoping it
 *   to PADI would leave an SSI/NAUI Try Scuba capped by nothing but the boat's
 *   capacity, which is worse than the 8/12 rule it replaced.
 * - A **non-intro entry-level** session (no `minimum_certification_level` — the
 *   Open Water training dives) is gated at `ENTRY_LEVEL_COURSE_RATIO`, and
 *   **only for PADI**: 8/+2/12 is a cited PADI figure, `courses.agency` is free
 *   text an SSI/NAUI course legitimately fills in, and applying a PADI number to
 *   another agency's course would be a wrong-but-confident safety control.
 * - Everything else is ungated: continuing-education courses already require a
 *   verified card at booking and PADI publishes no comparable numeric ratio.
 */
export function courseRatioKind(course: CourseCrewGapCourse): CourseRatioKind | null {
  if (!course) return null;
  if (course.isIntroCourse) return "intro";
  if (normalizeAgency(course.agency) !== "padi") return null;
  if (course.minimumCertificationLevel) return null;
  return "entry_level";
}

const RATIO_BY_KIND: Record<CourseRatioKind, CourseRatioRule> = {
  intro: INTRO_COURSE_RATIO,
  entry_level: ENTRY_LEVEL_COURSE_RATIO,
};

/** The rule `courseRatioKind` selected, or null when the session carries none. */
export function courseRatioRule(course: CourseCrewGapCourse): CourseRatioRule | null {
  const kind = courseRatioKind(course);
  return kind === null ? null : RATIO_BY_KIND[kind];
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
 * - `over_ratio`: a ratio-gated session (see `courseRatioKind`) has at least
 *   one instructor, but the crew's ratio capacity has fallen below the trip's
 *   booked count — day-of crew changes are unblocked (H-14), so this can drift
 *   after booking. A nudge to fix before sailing, never a retroactive block on
 *   the bookings already taken, and never a reason to refuse to *record* a crew
 *   change: an unrecorded change means the manifest lists crew who are not on
 *   the boat.
 * - `none`: adequately crewed, or not a ratio-gated session.
 *
 * `over_ratio` carries the `ratio` it was measured against, because the two
 * rules need different words: the entry-level cap is PADI's published Open
 * Water training figure and a certified assistant raises it, while the intro
 * cap is PADI's tighter published DSD open-water figure that an assistant does
 * not move at all. Telling a manager to add a divemaster to a DSD session is
 * advice that cannot work.
 */
export type CourseCrewGap =
  | { code: "none" }
  | { code: "no_instructor" }
  | { code: "over_ratio"; booked: number; capacity: number; ratio: CourseRatioKind };

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
  const kind = courseRatioKind(input.course);
  if (kind === null) return { code: "none" };
  const capacity = courseRatioCapacity(
    RATIO_BY_KIND[kind],
    input.instructorCount,
    input.assistantCount,
  );
  if (input.booked > capacity) {
    return { code: "over_ratio", booked: input.booked, capacity, ratio: kind };
  }
  return { code: "none" };
}

/** True whenever `courseCrewGap` found anything worth surfacing to staff. */
export function hasCourseCrewGap(gap: CourseCrewGap): boolean {
  return gap.code !== "none";
}
