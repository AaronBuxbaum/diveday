import type { Metadata } from "next";

/**
 * The site-level Open Graph fields — the ones that describe *DiveDay*, not the
 * page — in one place, because every page that exports its own `openGraph`
 * block silently loses them.
 *
 * Next merges `metadata` shallowly: a page's `openGraph` object **replaces**
 * the root layout's outright rather than merging into it
 * (`generate-metadata.md`, "Inheriting fields" — `mergeMetadata` in
 * `next/dist/lib/metadata/resolve-metadata.js` does a straight assignment). A
 * page has to export one the moment it wants its own unfurl words, so the
 * fields it never meant to touch — `siteName`, `type` — drop off with them.
 * The result is the inversion you see from outside: pages with nothing to say
 * about themselves carry `og:site_name` (inherited, no `og:url`), and the
 * pages that were written with care carry `og:url` but unfurl with no site
 * name at all.
 *
 * So: **every page that exports an `openGraph` block spreads this first.** It
 * is deliberately only the site-level pair — a card's image is a separate
 * decision (`sharedLinkCard` in `src/lib/marketing.ts` for the marketing
 * pages; a segment's own `opengraph-image.tsx` everywhere else), and `url` is
 * per page and must stay absent on bearer-token pages, where the URL is the
 * credential.
 */
export const openGraphSite = {
  // i18n-exempt: brand name, rendered as-is in every locale
  siteName: "DiveDay",
  type: "website",
} as const satisfies Metadata["openGraph"];

/**
 * The `robots` field for a shop's own public pages, from its opt-out stamp.
 *
 * A shop is indexed by default — being findable is most of the point of having
 * a public schedule — but it can say no, and saying no has to reach the page
 * as well as the sitemap (ADR 20260813-search-listing-is-a-choice). Dropping
 * out of `sitemap.xml` alone would not un-index anything a crawler had already
 * found or that anyone had linked to.
 *
 * Returns `undefined` when the shop has not opted out, so the page inherits
 * the site default rather than stating an explicit `index: true` that would
 * have to be kept in step with the root layout.
 */
export function shopSearchListingRobots(
  optedOutAt: Date | null | undefined,
): Metadata["robots"] | undefined {
  return optedOutAt ? { index: false, follow: false } : undefined;
}
