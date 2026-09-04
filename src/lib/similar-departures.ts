/**
 * **What else this shop is running, when the boat a diver wanted is full**
 * (issue #1166, delight report D06).
 *
 * A full departure used to end the conversation at two doors: join the wait
 * list, or follow a link to the whole schedule and work it out yourself. The
 * shop usually knows a better answer than "here is the board" — it is running
 * the same course on Saturday, or the same site on Thursday — and saying so is
 * the difference between a diver queueing and a diver diving.
 *
 * **Relevance is the whole rule.** D06's boundary is "offer only relevant
 * alternatives", so this recognises exactly two kinds of sameness and offers
 * nothing at all when neither holds:
 *
 * - **the same course**, which is the same *thing* — a diver who wanted Open
 *   Water on the 14th wants Open Water, and any session of it will do;
 * - **the same dive site**, which is the same *place* — the reason a diver
 *   picked this boat may well be the wreck it goes to.
 *
 * Course outranks site, because a course session is a commitment to a
 * syllabus and a site is a preference. A departure that is both is reported as
 * the course, which is the stronger claim and the one worth making.
 *
 * Nothing else counts. "Also a two-tank" or "also on a Thursday" would be the
 * invented relevance the boundary rules out, and a list of vaguely-similar
 * boats is the schedule page with extra steps — which the surface already
 * links to.
 *
 * Pure and framework-free: the candidates arrive from
 * `pagedUpcomingTripsWithCounts` (which already filters to public departures
 * with a seat left), and the words live in the diver bundle.
 */

/** Why an alternative is being offered. Never a sentence — the surface picks the words. */
export type SimilarReason = "same_course" | "same_site";

export type SimilarDeparture = {
  tripId: string;
  title: string;
  startsAt: Date;
  reason: SimilarReason;
};

/** The departure a diver could not get on. */
export type FullDeparture = {
  tripId: string;
  courseId: string | null;
  diveSiteId: string | null;
};

/** One departure that might do instead, as the schedule reader already returns it. */
export type SimilarCandidate = {
  id: string;
  title: string;
  startsAt: Date;
  courseId: string | null;
  diveSiteId: string | null;
};

/**
 * At most `limit` departures worth offering, soonest first within each kind of
 * sameness and course before site.
 *
 * Two is the default and it is a taste decision rather than an arbitrary one:
 * one reads as the shop's only answer, and three is a list a reader has to
 * work through on a page whose whole job at that moment is to say "here is
 * what to do next".
 */
export function similarDepartures(input: {
  full: FullDeparture;
  candidates: readonly SimilarCandidate[];
  limit?: number;
}): SimilarDeparture[] {
  const limit = input.limit ?? 2;
  if (limit <= 0) return [];

  const matched: SimilarDeparture[] = [];
  for (const candidate of input.candidates) {
    // The boat they could not get on is not an alternative to itself.
    if (candidate.id === input.full.tripId) continue;
    // A null on either side is "this departure names no course" / "names no
    // site", and two absences are not a match — otherwise every fun dive with
    // no site set would read as similar to every other one.
    const reason: SimilarReason | null =
      input.full.courseId && candidate.courseId === input.full.courseId
        ? "same_course"
        : input.full.diveSiteId && candidate.diveSiteId === input.full.diveSiteId
          ? "same_site"
          : null;
    if (!reason) continue;
    matched.push({
      tripId: candidate.id,
      title: candidate.title,
      startsAt: candidate.startsAt,
      reason,
    });
  }

  return matched
    .sort(
      (a, b) =>
        Number(a.reason === "same_site") - Number(b.reason === "same_site") ||
        a.startsAt.getTime() - b.startsAt.getTime() ||
        a.tripId.localeCompare(b.tripId),
    )
    .slice(0, limit);
}
