import { DAY_MS } from "@/lib/clock";
import { canonicalAgency } from "@/lib/courses";

/**
 * **The course ladder: who finished here and never took the next step**
 * (fifth-loop ideas, item 45; H-130 for its one-to-one invites).
 *
 * The next step is read off the shop's own catalog, the way the progression
 * order is (`src/db/courses.ts`): a taster (Discover Scuba) leads into the
 * same agency's entry certification (a course open to the uncertified that
 * certifies), and a certification leads into the same agency's course whose
 * minimum is that level. Only active, non-taster courses are a next step, and
 * the first in progression order wins, so the answer is one course or none.
 */
export const COURSE_LADDER_LOOKBACK_DAYS = 365;

export function courseLadderSince(now: Date): Date {
  return new Date(now.getTime() - COURSE_LADDER_LOOKBACK_DAYS * DAY_MS);
}

export type LadderCourse = {
  id: string;
  title: string;
  agency: string;
  isActive: boolean;
  isIntroCourse: boolean;
  minimumCertificationLevel: string | null;
  certifiesLevel: string | null;
};

/** The course that follows `course`, from `catalog` in progression order, or `null`. */
export function nextCourseFor<T extends LadderCourse>(course: T, catalog: readonly T[]): T | null {
  const agency = canonicalAgency(course.agency);
  const leadsFrom = course.isIntroCourse ? null : course.certifiesLevel;
  if (!course.isIntroCourse && leadsFrom === null) return null;
  return (
    catalog.find(
      (candidate) =>
        candidate.id !== course.id &&
        candidate.isActive &&
        !candidate.isIntroCourse &&
        candidate.certifiesLevel !== null &&
        canonicalAgency(candidate.agency) === agency &&
        candidate.minimumCertificationLevel === leadsFrom,
    ) ?? null
  );
}
