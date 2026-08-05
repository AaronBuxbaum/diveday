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

/**
 * A shop slug as the routes spell it: lowercase, digits, inner hyphens. Kept
 * in step with the embed matchers in src/lib/auth.config.ts.
 */
const SHOP_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The shop a staff URL names, or `null` when it names none.
 *
 * A signed-out visitor who follows a `/shop/<slug>/…` link lands on the staff
 * sign-in form, and Auth.js carries where they were headed in `?callbackUrl=`.
 * That parameter is the only evidence of *which* shop they wanted, so the
 * sign-in page reads it to offer that shop's public schedule instead of
 * stranding a diver at a password field. Returns `null` rather than a guess
 * whenever the URL is absent, malformed, points somewhere other than `/shop/`,
 * or carries a segment that isn't a slug — the caller then shows no link at
 * all, because a link to the wrong shop is worse than none.
 *
 * The result is only ever used to build an internal `/s/<slug>` path, so an
 * attacker-supplied `callbackUrl` cannot turn this into an open redirect; the
 * charset check is what keeps it from becoming one anyway.
 */
export function shopSlugFromStaffUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  let pathname: string;
  try {
    // Absolute (Auth.js sends the full href) or relative — a base makes both parse.
    pathname = new URL(candidate, "http://localhost").pathname;
  } catch {
    return null;
  }
  const [prefix, slug] = pathname.split("/").filter(Boolean);
  if (prefix !== "shop" || !slug || !SHOP_SLUG.test(slug)) return null;
  return slug;
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
 * that moves: the catalog index kept a genuine staff surface at its URL (the
 * roster and the editor), while a course page had no staff function beyond
 * previewing a hidden course — and it is the one course URL carried in the
 * sitemap and in structured data. The negative lookahead keeps the staff
 * segments (`new`, `catalog`, and `paths`, which the certification-path
 * builder used before ADR 20260805-remove-certification-paths and which stays
 * reserved so an old bookmark cannot be captured by a course slugged "paths")
 * out of it, matching `RESERVED_COURSE_SEGMENTS` in src/lib/courses.ts.
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
