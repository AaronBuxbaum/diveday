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
