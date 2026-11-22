import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";

/**
 * The slug of the shop's "Easygoing reef" word (`trip_lenses.slug`). A lens is
 * the shop's own vocabulary, so this names the word DiveDay's demo and
 * templates ship; a shop that tags its gentle boats under another word is
 * served by the beginner site rating instead. The slug is derived once on
 * create and never rewritten (`lensSlugFrom`), so a rename keeps it.
 */
export const EASYGOING_LENS_SLUG = "easygoing-reef";

/** One public departure a diver could take, as the pick reads it. */
export type FirstBoatCandidate = {
  tripId: string;
  title: string;
  startsAt: Date;
  seatsOpen: number;
  /** Set for a course session. */
  courseId: string | null;
  /** The slug of the shop's word on the departure, when it wears one. */
  lensSlug: string | null;
  /** The shop's rating of each distinct planned site; null is a site it has not rated. */
  plannedSiteDifficulties: readonly (DiveSiteDifficulty | null)[];
};

/** A departure the shop itself calls easygoing, or whose every planned site it rates for beginners. */
function isGentle(candidate: FirstBoatCandidate): boolean {
  if (candidate.lensSlug === EASYGOING_LENS_SLUG) return true;
  const sites = candidate.plannedSiteDifficulties;
  return sites.length > 0 && sites.every((difficulty) => difficulty === "beginner");
}

/**
 * **A good first boat after a refresher** (issue #4898): the earliest public
 * departure that starts after the session ends, has a seat left, is not a
 * course session, and is easygoing by the shop's own tag or beginner ratings.
 * Null when nothing qualifies, and the page then says nothing.
 *
 * It suggests and never gates: it reads no diver, and admission
 * (`trip-admission.ts`) and readiness (`readiness.ts`) are untouched.
 */
export function firstBoatAfterwards(input: {
  sessionEndsAt: Date;
  candidates: readonly FirstBoatCandidate[];
}): FirstBoatCandidate | null {
  const qualifying = input.candidates
    .filter(
      (candidate) =>
        candidate.courseId === null &&
        candidate.seatsOpen > 0 &&
        candidate.startsAt.getTime() > input.sessionEndsAt.getTime() &&
        isGentle(candidate),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.tripId < b.tripId ? -1 : 1));
  return qualifying[0] ?? null;
}
