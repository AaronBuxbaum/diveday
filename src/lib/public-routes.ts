/**
 * The diver-facing shop namespace.
 *
 * Everything a diver reads without an account lives under `/s/<shopSlug>`;
 * `/shop/<shopSlug>/**` is staff-only, without exception (ADR
 * 20260803-public-shop-namespace). Keeping the path strings in one framework-
 * free module is what lets the route matchers (src/proxy.ts, edge),
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

/**
 * DiveDay's own door for a diver who lost their link (fourth review, item
 * 50): a picker of listed shops, each leading to that shop's find-my-booking.
 */
export const FIND_YOUR_BOOKING_PATH = "/find-your-booking";

/** The find-my-booking row's id on the shop home, and so its fragment. */
export const FIND_MY_BOOKING_FRAGMENT = "find-my-booking";

/**
 * A shop's find-my-booking row: the shop home, with the row open on arrival
 * (`DisclosureRow` opens on its own fragment).
 */
export function publicFindMyBookingPath(shopSlug: string): string {
  return `${publicSchedulePath(shopSlug)}#${FIND_MY_BOOKING_FRAGMENT}`;
}

/** The shop's public review archive. */
export function publicReviewsPath(shopSlug: string): string {
  return `${publicSchedulePath(shopSlug)}/reviews`;
}

/** The shop's prepaid dive packages, bought online (shown only when it sells any). */
export function publicPackagesPath(shopSlug: string): string {
  return `${publicSchedulePath(shopSlug)}/packages`;
}

/**
 * The shop's own self-registration door — the page behind the QR a shop prints
 * for its counter (issue #1236). `noindex`, and deliberately not linked from
 * the public header: a shop hands this out, it is not somewhere a diver
 * browses to.
 */
export function publicShopRegisterPath(shopSlug: string): string {
  return `${PUBLIC_SHOP_PREFIX}/${shopSlug}/register`;
}

/**
 * The shop's machine-readable availability document — the next two weeks of
 * open seats as JSON, for an agent that finds a departure and hands its
 * reader to the booking page (issue #1427). Sits beside the schedule it
 * summarises, and 404s for a shop that has taken itself out of search (ADR
 * 20260813-search-listing-is-a-choice): a shop that said no to Google said
 * no to the same fact reaching a travel agent's model.
 */
export function publicAvailabilityPath(shopSlug: string): string {
  return `${publicSchedulePath(shopSlug)}/availability.json`;
}

/** The site-level overview an agent reads first, at the conventional path. */
export const LLMS_TXT_PATH = "/llms.txt";

/** One departure's public booking page. */
export function publicTripPath(shopSlug: string, tripId: string): string {
  return `${PUBLIC_SHOP_PREFIX}/${shopSlug}/trips/${tripId}`;
}

/** The `.ics` download for one departure. */
export function publicTripCalendarPath(shopSlug: string, tripId: string): string {
  return `${publicTripPath(shopSlug, tripId)}/calendar`;
}

/**
 * The booked diver's own HTML arrival card, saved for a no-signal morning.
 *
 * Public in shape only: the route refuses every request without a `?booking=`
 * readiness capability for this very trip, and the card it returns carries an
 * `arrival` credential in a QR (issue #1600). It sits under the public tree
 * because it is the diver's door rather than a staff one — not because anyone
 * may fetch it.
 */
export function publicTripArrivalCardPath(shopSlug: string, tripId: string): string {
  return `${publicTripPath(shopSlug, tripId)}/arrival-card`;
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
 * One dive site's public page — the shop's own briefing for a place, at a URL
 * a diver can share and a search engine can index (N-48).
 *
 * The segment is `dive_sites.slug`, minted once from the name and never
 * rewritten (`src/lib/dive-site-slug.ts`), so a shop correcting its own
 * spelling does not 404 the link somebody posted last week.
 */
export function publicDiveSitePath(shopSlug: string, siteSlug: string): string {
  return `${PUBLIC_SHOP_PREFIX}/${shopSlug}/sites/${siteSlug}`;
}

/**
 * A shop slug as the routes spell it — and it is `onboardSchema`'s rule,
 * imported by the minter rather than restated, so the two cannot drift again.
 * Lowercase, digits and hyphens, in any arrangement; same charset the embed
 * matchers in src/lib/embed-routes.ts already use.
 *
 * It used to be `^[a-z0-9]+(?:-[a-z0-9]+)*$`, which reads like a slug and is
 * not what a shop can own: sign-up accepts `[a-z0-9-]+`, so `blue--mantis`,
 * `-reef` and `reef-` are live storefronts every reader of this pattern then
 * refused to name. The one a diver saw was `src/app/not-found.tsx`: a dead
 * link under such a shop lost its frame and was answered by DiveDay's *sales*
 * 404 with a trial button, which is the first impression issue #765 exists to
 * prevent. A matcher narrower than the minting rule is a bug in the matcher.
 */
export const SHOP_SLUG_PATTERN = /^[a-z0-9-]+$/;

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
  if (prefix !== "shop" || !slug || !SHOP_SLUG_PATTERN.test(slug)) return null;
  return slug;
}

/**
 * The shop a **public** URL names, read from a pathname rather than a full URL.
 *
 * `not-found.tsx` is the one surface in this namespace that is handed no
 * `params` — Next passes that file no props at all — so a 404 under
 * `/s/<slug>/**` learns which shop the visitor was trying to reach from
 * `REQUEST_PATH_HEADER`, which `src/proxy.ts` stamps and always overwrites.
 * Same rule as its staff sibling above: the slug is held to
 * `SHOP_SLUG_PATTERN`, and anything else — a path outside `/s/`, a bare `/s`,
 * a segment carrying a dot or a slash — is `null`, which the caller renders as
 * no link at all. The value is only ever concatenated by
 * `publicSchedulePath`, so a slug that somehow arrived from a client still
 * cannot address anything but this app.
 */
export function shopSlugFromPublicPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const [prefix, slug] = pathname.split("/").filter(Boolean);
  if (`/${prefix}` !== PUBLIC_SHOP_PREFIX || !slug || !SHOP_SLUG_PATTERN.test(slug)) return null;
  return slug;
}
