/**
 * The faces a diver might meet at one site — the site's own field guide.
 *
 * A field guide is a **selection**: which species from DiveDay's catalog this
 * site shows, and in what order. Nothing here is a word. The shop chooses the
 * faces; the sentences under them come from `marineLife.*` in the reader's own
 * language, resolved at render by `src/i18n/marine-life-labels.ts` (ADR
 * 20260813-marine-life-is-diveday-copy).
 *
 * Until that ADR the rows carried a name, a category word, a sentence and a tip
 * the shop had typed, copied out of the catalog at pick time. That made the
 * guide the shop's own words, which was the point — and it also meant a
 * Spanish-speaking shop that took DiveDay's starting text and saved it, as most
 * did, published an English field guide inside a Spanish briefing, with no way
 * to have both languages from one row.
 *
 * `MAX_SITE_CREATURES` and the ordering are unchanged; what left is the text.
 */

import { isMarineLifeSlug, type MarineLifeSlug } from "@/db/marine-life-catalog";
import { safeJson } from "./safe-json";

/**
 * The most species one site's guide may hold. Eight fills two rows of the
 * briefing's four-up grid; past that a reader is scrolling a catalog rather
 * than learning a handful of faces before a dive.
 */
export const MAX_SITE_CREATURES = 8;

/**
 * A posted field guide from anywhere untrusted — the form's hidden JSON input,
 * a template's briefing blob, a row written by an older build — reduced to what
 * every renderer can assume: catalog slugs the app has words for, in order,
 * without repeats, at most `MAX_SITE_CREATURES` of them.
 *
 * Never throws, and an empty guide is a first-class answer — a site the shop
 * has nothing to say about yet is the ordinary case, and the briefing reads
 * fine in that state.
 *
 * **A slug the catalog does not carry is dropped, not stored.** That is the
 * whole safety property of the selection model: past this function every stored
 * row is one the bundles are known to have three strings for, in every locale,
 * so nothing downstream can render a slug at a diver. It also closes what used
 * to be an injection surface — this input carried four free-text fields that
 * landed on a public page.
 */
export function parseFieldGuideSelection(raw: unknown): MarineLifeSlug[] {
  const list = typeof raw === "string" ? safeJson(raw) : raw;
  if (!Array.isArray(list)) return [];
  const slugs: MarineLifeSlug[] = [];
  for (const entry of list) {
    if (slugs.length >= MAX_SITE_CREATURES) break;
    // Tolerates both shapes the form and the templates have posted: a bare
    // slug string, and the `{ slug, name, … }` object the pre-selection editor
    // sent. The words on the old shape are ignored, which is the migration.
    const value =
      typeof entry === "string"
        ? entry
        : typeof entry === "object" && entry !== null
          ? (entry as Record<string, unknown>).slug
          : undefined;
    if (typeof value !== "string") continue;
    const slug = value.trim();
    if (!isMarineLifeSlug(slug) || slugs.includes(slug)) continue;
    slugs.push(slug);
  }
  return slugs;
}
