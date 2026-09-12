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
 * decision (`sharedLinkCardImage` below, and `sharedLinkCard` in
 * `src/lib/marketing.ts`, which is this pair plus that image; a segment's own
 * `opengraph-image.tsx` everywhere else), and `url` is per page and must stay
 * absent on bearer-token pages, where the URL is the credential.
 *
 * **The card is not folded in here, and that is load-bearing.** Next skips a
 * segment's own `opengraph-image` file whenever that level's `openGraph` block
 * carries an own `images` property (`mergeStaticMetadata` in
 * `next/dist/lib/metadata/resolve-metadata.js`). Every page that spreads this
 * constant would therefore shadow its *own* card with the generic one — the
 * per-shop schedule card, the departure card and the recap card all live on
 * pages that spread it.
 */
export const openGraphSite = {
  // i18n-exempt: brand name, rendered as-is in every locale
  siteName: "DiveDay",
  type: "website",
} as const satisfies Metadata["openGraph"];

/** The card's pixels, read by the route that draws it and the metadata that names it. */
export const LINK_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * **DiveDay's own link-preview card, named rather than attached by file
 * convention.** `src/app/link-card/route.tsx` draws it.
 *
 * It was `src/app/opengraph-image.tsx` until issue #1709. Next attaches a
 * metadata module to **every page entry**, so that file's
 * `import { ImageResponse } from "next/og"` put 3.07 MiB of satori, its
 * bundled font, `resvg.wasm` and `yoga.wasm` into the traced closure of every
 * route in the app — `/sign-in`, a staff settings form, every page that
 * renders no image at all. A route handler is its own closure and is attached
 * to nothing, which is why `src/app/pwa-icon-maskable/route.tsx` is one too
 * (ADR 20260804-og-svg-rasterizer's amendment).
 *
 * What naming it costs: Next's generated metadata URL carried a
 * `?<contenthash>` that a hand-written path cannot, so a chat client holding
 * cached bytes keeps them until its own cache turns over. Every marketing page
 * except `/` already paid exactly that through `sharedLinkCard`; `/` now does
 * too. Keep `alt` and the size in step with the route — they are this card's
 * contract with every unfurl, and the route no longer exports them.
 */
export const sharedLinkCardImage = {
  url: "/link-card",
  width: LINK_CARD_SIZE.width,
  height: LINK_CARD_SIZE.height,
  // i18n-exempt: alt text for crawlers and chat clients, which carry no visitor locale — the same carve-out as static `metadata.title`.
  alt: "DiveDay — dive shop software: who's booked, who's cleared, who's on the boat, one answer all day.",
  type: "image/png",
  // `satisfies`, so a mistyped field is a compile error rather than a tag Next
  // silently drops — the only reader of these five keys is a crawler.
} as const satisfies NonNullable<NonNullable<Metadata["openGraph"]>["images"]>;

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
