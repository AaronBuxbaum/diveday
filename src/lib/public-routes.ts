/**
 * The diver-facing shop namespace.
 *
 * Everything a diver reads without an account lives under `/s/<shopSlug>`;
 * `/shop/<shopSlug>/**` is staff-only, without exception (ADR
 * 20260803-public-shop-namespace). Keeping the path strings in one framework-
 * free module is what lets the route matchers (src/lib/auth.config.ts, edge),
 * the redirect table (next.config.ts, build time), the pages, the sitemap, and
 * every notification URL builder agree by construction rather than by grep.
 *
 * Paths only — never a sentence, never a locale-formatted value.
 */

/** Root segment of the public namespace. Short because divers share these links. */
export const PUBLIC_SHOP_PREFIX = "/s";

/** The shop's public schedule — calendar, trip list, reviews, deal signup. */
export function publicSchedulePath(shopSlug: string): string {
  return `${PUBLIC_SHOP_PREFIX}/${shopSlug}`;
}

/** One departure's public booking page. */
export function publicTripPath(shopSlug: string, tripId: string): string {
  return `${PUBLIC_SHOP_PREFIX}/${shopSlug}/trips/${tripId}`;
}

/** The `.ics` download for one departure. */
export function publicTripCalendarPath(shopSlug: string, tripId: string): string {
  return `${publicTripPath(shopSlug, tripId)}/calendar`;
}

/** The diver-facing course catalog (the staff roster is /shop/<slug>/courses). */
export function publicCoursesPath(shopSlug: string): string {
  return `${PUBLIC_SHOP_PREFIX}/${shopSlug}/courses`;
}

/** One course's public page. */
export function publicCoursePath(shopSlug: string, courseSlug: string): string {
  return `${publicCoursesPath(shopSlug)}/${courseSlug}`;
}

/** The certification-path index a diver reads (the builder stays on /shop). */
export function publicCoursePathsPath(shopSlug: string): string {
  return `${publicCoursesPath(shopSlug)}/paths`;
}

/** One certification path's public page. */
export function publicCoursePathPath(shopSlug: string, pathSlug: string): string {
  return `${publicCoursePathsPath(shopSlug)}/${pathSlug}`;
}

/**
 * The old `/shop/**` URLs these surfaces used to live at, and where each one
 * now points. Consumed by `next.config.ts` to emit permanent (308) redirects —
 * a QR code on a dive-shop counter, a bookmarked booking link, and an embed
 * iframe already pasted into a shop's own website all keep working, query
 * string intact (Next carries it through a config redirect).
 *
 * `source` patterns are path-to-regexp, matched before the proxy runs (Next
 * evaluates `redirects` ahead of proxy), so these paths never reach the auth
 * layer at all.
 *
 * The course *detail* page is the only thing under `/shop/<slug>/courses/**`
 * that moves: the catalog index, the certification-path index, and each path's
 * own page kept a genuine staff surface at their URL (roster, builder, editor),
 * while a course page had no staff function beyond previewing a hidden course —
 * and it is the one course URL carried in the sitemap and in structured data.
 * The negative lookahead keeps the staff segments (`paths`, `new`, `catalog`,
 * matching `RESERVED_COURSE_SEGMENTS` in src/lib/courses.ts) out of it.
 */
export const LEGACY_PUBLIC_SHOP_REDIRECTS: readonly { source: string; destination: string }[] = [
  { source: "/shop/:shopSlug/schedule", destination: `${PUBLIC_SHOP_PREFIX}/:shopSlug` },
  {
    // `board` is the staff operations board and stays under /shop; every other
    // segment here is a trip id.
    source: "/shop/:shopSlug/schedule/:tripId((?!board$)[^/]+)",
    destination: `${PUBLIC_SHOP_PREFIX}/:shopSlug/trips/:tripId`,
  },
  {
    source: "/shop/:shopSlug/schedule/:tripId((?!board$)[^/]+)/calendar",
    destination: `${PUBLIC_SHOP_PREFIX}/:shopSlug/trips/:tripId/calendar`,
  },
  {
    source: "/shop/:shopSlug/courses/:courseSlug((?!paths$|new$|catalog$)[^/]+)",
    destination: `${PUBLIC_SHOP_PREFIX}/:shopSlug/courses/:courseSlug`,
  },
];
