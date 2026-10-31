/**
 * How demanding a dive site is, as one of three codes.
 *
 * A code and not the shop's own adjective, because the word is rendered to a
 * diver and has to arrive in their language (ADR
 * 20260813-marine-life-is-diveday-copy applied the same reasoning to species;
 * this is the field beside it that was still free text). `src/i18n/dive-site-labels.ts`
 * holds the words; nothing here is prose.
 *
 * The three are not a scale DiveDay invented — they are exactly the values
 * every shop and every published template had already typed into the free-text
 * field it replaces, which is the strongest evidence available that they are
 * the ones a dive shop reaches for.
 *
 * **It advises, it never gates.** A diver is admitted to a trip by
 * `src/lib/trip-admission.ts` and cleared to board by `src/lib/readiness.ts`,
 * both of which read certification levels and specialties. This is a word on a
 * briefing, and a site with no difficulty set is the ordinary case.
 */
export const DIVE_SITE_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;

export type DiveSiteDifficulty = (typeof DIVE_SITE_DIFFICULTIES)[number];

/**
 * **The dive-site library's groups, easiest first.** The three codes, then
 * everything the shop has not rated (ADR 20260827-the-shops-shelves: the
 * library renders as one ledger grouped by the collection's own shared fact).
 *
 * `unrated` is a real group and not a gap — a shop that has written nine
 * briefings and rated four of them has five sites in it, and filing them under
 * a guess would be the one thing this module exists to refuse. It sorts last
 * because the three that carry a reading are the ones a staffer scans for.
 *
 * The order is load-bearing twice over: it is the order the groups render in,
 * and — because `difficulty_level` is a Postgres enum, which sorts by
 * declaration order with NULL last — it is also the order the library's row
 * query returns. Reordering `DIVE_SITE_DIFFICULTIES` moves both together,
 * which is why neither one restates it.
 */
export const SITE_LIBRARY_GROUPS = [...DIVE_SITE_DIFFICULTIES, "unrated"] as const;

/** Which group a library row falls in. */
export type SiteLibraryGroupLabel = (typeof SITE_LIBRARY_GROUPS)[number];

/**
 * A stored or posted value narrowed to a code, or null.
 *
 * Lower-cased and trimmed. Anything that is not one of the three codes reads as
 * "not said" — which is what the briefing already renders when the field is
 * empty, so an unrecognised word degrades to silence rather than to a wrong
 * reading.
 */
export function parseDiveSiteDifficulty(value: unknown): DiveSiteDifficulty | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return (DIVE_SITE_DIFFICULTIES as readonly string[]).includes(code)
    ? (code as DiveSiteDifficulty)
    : null;
}

/**
 * **Whether a site is any good for a snorkeler** (issue #2214), as the form
 * posts it: `"yes"`, `"no"`, or anything else for "not said". Null is the
 * ordinary case and is never read as no.
 */
export function parseSnorkelSuitable(value: unknown): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

/**
 * **Snorkelers can be aboard a departure whose planned sites the shop has
 * marked unsuitable for snorkelers** (issue #2214; Aaron 2026-10-13).
 *
 * True only when snorkeler seats are open or a snorkeler is already booked
 * (closing the seats does not take a booked one off the boat, domain review
 * F8), and *every* planned site says no. One site
 * that is suitable, or one the shop has not rated, keeps it quiet: the captain
 * picks the site on the day, and a site nobody rated is not evidence of
 * anything. A departure with no site planned is quiet too, for the same
 * reason; a dive with no site chosen is not a planned site.
 *
 * It advises, it never gates: a warning line on the departure, never a
 * refusal of a snorkeler's seat.
 */
export function snorkelersOnUnsuitableSites(input: {
  snorkelerSeatsOpen: boolean;
  /** Live snorkeler bookings on the departure. */
  snorkelersBooked: number;
  plannedSites: readonly { snorkelSuitable: boolean | null }[];
}): boolean {
  const snorkelersAboard = input.snorkelerSeatsOpen || input.snorkelersBooked > 0;
  if (!snorkelersAboard || input.plannedSites.length === 0) return false;
  return input.plannedSites.every((site) => site.snorkelSuitable === false);
}
