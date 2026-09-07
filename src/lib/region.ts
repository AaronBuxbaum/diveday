/**
 * **A region is the shop's own locality, spelled as a path segment**
 * (issue #1436, improvement-ideas N-49).
 *
 * `/dive/key-largo` lists every listed shop whose address says Key Largo. The
 * slug is derived from `shops.address_locality` and nothing else — no
 * geocoding, no curated list of places, no operator-side mapping table — and
 * it is stored on the shop row (`shops.region_slug`) the moment the address
 * saves, so the page reads an indexed column rather than re-deriving it over
 * every shop on every request. The derivation is deterministic and pure, and
 * `regionSlugFromLocality("Key Largo") === "key-largo"` is the whole
 * contract: two shops that type the same town land on the same page, and a
 * shop that types nothing lands on none.
 *
 * Deliberately the locality alone, not locality + region + country. A slug
 * that read `key-largo-fl-us` would be honest and unshareable; `/dive/key-largo`
 * is what a person types. The cost is that two towns with one name in two
 * states share a page, which is filed as a follow-up rather than solved here
 * with a disambiguator nobody has needed yet.
 */

/** A region slug as the route spells it: lowercase, digits, inner hyphens. */
const REGION_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The longest slug a locality may produce; longer is truncated at a hyphen. */
const MAX_REGION_SLUG_LENGTH = 64;

/**
 * The region slug for a locality as a shop typed it, or `null` when the
 * locality is empty or carries nothing a slug can be made of.
 *
 * Case-folded, diacritics stripped (`Cozumel` and `Cozúmel` are one place),
 * every run of anything that is not a letter or a digit collapsed to one
 * hyphen, leading and trailing hyphens dropped.
 */
export function regionSlugFromLocality(locality: string | null | undefined): string | null {
  if (!locality) return null;
  const slug = locality
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  if (slug.length <= MAX_REGION_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_REGION_SLUG_LENGTH).replace(/-+$/, "");
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}

/**
 * Whether a path segment is a region slug this app could have produced. A
 * `[region]` param that fails this is a 404 before any query runs — a slug is
 * only ever spent on an equality match against `shops.region_slug`, so this is
 * shape hygiene rather than a security boundary.
 */
export function isRegionSlug(candidate: string | null | undefined): candidate is string {
  return typeof candidate === "string" && candidate.length <= MAX_REGION_SLUG_LENGTH && REGION_SLUG.test(candidate);
}

/** The regional index and one region's page. */
export const REGIONS_PATH = "/dive";

export function regionPath(regionSlug: string): string {
  return `${REGIONS_PATH}/${regionSlug}`;
}
