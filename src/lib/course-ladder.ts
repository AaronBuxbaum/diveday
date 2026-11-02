import { checkMinimumAge } from "@/lib/age";
import type { CalendarDate } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { DAY_MS } from "@/lib/clock";
import { canonicalAgency } from "@/lib/courses";
import { certificationRank } from "@/lib/readiness";

/**
 * **The course ladder: who finished here and never took the next step**
 * (fifth-loop ideas, item 45; H-20261014-one-to-one-invite for its one-to-one invites).
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
  minimumCertificationLevel: CertificationLevel | null;
  certifiesLevel: CertificationLevel | null;
  minimumAge: number | null;
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

/**
 * Why a person is left off the ladder's list for `next`, or `null` when they
 * may be asked (dive-domain review F3):
 *
 * - `holds_next`: a card at or above the level `next` certifies, from any
 *   agency and in any state (verified, pending, imported, self-declared). A
 *   vacation try-diver who certified at home, or a diver whose Advanced card
 *   from elsewhere is on file, has already passed the course. Levels are one
 *   ladder across agencies, so the comparison is by rank.
 * - `under_age`: younger than `next.minimumAge` on `onDate` (the session's
 *   day). No date of birth on file never refuses (H-20260724-certification-levels-agency-rules).
 */
export type LadderExclusion = "holds_next" | "under_age";

export function ladderExclusion(
  next: { certifiesLevel: CertificationLevel | null; minimumAge: number | null },
  person: { heldLevels: readonly CertificationLevel[]; dateOfBirth: CalendarDate | null },
  onDate: CalendarDate,
): LadderExclusion | null {
  if (next.certifiesLevel) {
    const needed = certificationRank(next.certifiesLevel);
    if (person.heldLevels.some((level) => certificationRank(level) >= needed)) return "holds_next";
  }
  if (checkMinimumAge(person.dateOfBirth, next.minimumAge, onDate).status === "under") {
    return "under_age";
  }
  return null;
}
