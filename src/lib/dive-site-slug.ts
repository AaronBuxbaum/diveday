/**
 * **A dive site's public URL segment** (N-48).
 *
 * `/s/<shop>/sites/molasses-reef`, from the name the shop typed. The words a
 * site page ranks on are the shop's own briefing, so its URL is the shop's own
 * name for the place rather than the uuid that names the row.
 *
 * Derived **once, on create**, and never rewritten — the same contract
 * `trip_lenses.slug` has and for the same reason: correcting "Molasses reef"
 * to "Molasses Reef" must not 404 the link a diver shared yesterday, or the
 * result a search engine has already indexed.
 */

import { slugFrom } from "./slug";

/** The shape `dive_sites.slug` holds: lowercase words joined by single hyphens. */
export const DIVE_SITE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The longest a site slug may run. Longer than a lens's forty because a site
 * name is a place ("Christ of the Abyss Statue, Key Largo Dry Rocks") rather
 * than a one- or two-word label, and truncating one to forty characters puts
 * two different moorings on the same URL.
 */
export const DIVE_SITE_SLUG_MAX = 80;

/**
 * The shop's name for the place, as a URL segment.
 *
 * `taken` is the shop's live site slugs. A collision is rare — the
 * `dive_sites_shop_name_unique` index already stops two sites sharing a name —
 * but two *different* names can fold to one segment ("Molasses Reef" and
 * "Molasses  Reef!"), and a shop that hits that gets `molasses-reef-2` rather
 * than a failed save.
 */
export function diveSiteSlugFrom(name: string, taken: Iterable<string> = []): string {
  return slugFrom(name, { max: DIVE_SITE_SLUG_MAX, fallback: "dive-site", taken });
}

/**
 * The slug a `/sites/<segment>` URL names, or null.
 *
 * Null for malformed alike, so a caller `notFound()`s on a segment that could
 * never have been minted rather than putting it into a query.
 */
export function parseDiveSiteSlug(candidate: string | undefined): string | null {
  if (!candidate || candidate.length > DIVE_SITE_SLUG_MAX) return null;
  return DIVE_SITE_SLUG_PATTERN.test(candidate) ? candidate : null;
}
