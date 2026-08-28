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
 * Reads the legacy free text too, lower-cased and trimmed: `dive_sites.difficulty`
 * held whatever a shop typed until 2026-08-13, published template versions are
 * immutable snapshots that still carry it, and every value either of them ever
 * held was one of these three. Anything else reads as "not said" — which is
 * what the briefing already renders when the field is empty, so an unrecognised
 * word degrades to silence rather than to a wrong reading.
 */
export function parseDiveSiteDifficulty(value: unknown): DiveSiteDifficulty | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return (DIVE_SITE_DIFFICULTIES as readonly string[]).includes(code)
    ? (code as DiveSiteDifficulty)
    : null;
}
