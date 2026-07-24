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
