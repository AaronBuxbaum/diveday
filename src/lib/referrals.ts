/**
 * Which partner sent a diver — the one fact that travels from a hotel's link
 * to the booking it produces.
 *
 * The embed generator writes a partner link as the shop's storefront carrying
 * `utm_source=partner&utm_medium=referral&utm_campaign=<slug>`
 * (`partnerLinkUrl`, src/lib/embed-snippets.ts). That link lands on the
 * schedule; the diver then picks a departure and books on a different page, so
 * nothing in the booking request itself still carries the partner. This module
 * is the small amount of machinery that closes that gap, and the invariants it
 * holds are the reason it is one module rather than a slug helper in one file
 * and a cookie name in another.
 *
 * **Normalised in exactly one place.** `partnerReferralSlug` is what the
 * generator writes *and* what the edge re-runs on the way in, so a value that
 * reaches the database is a value this function could have produced. The
 * partner name a shop types is free text; the slug is not.
 *
 * **Bounded, because it is a third party's identity on a person's booking.**
 * The cookie is set from the URL and read back into a column, which is exactly
 * the shape that becomes a storage sink if nothing caps it. `MAX_SLUG_LENGTH`
 * is deliberately far above any real hotel name and far below anything worth
 * abusing.
 *
 * No server imports: the edge layer that writes the cookie, the booking action
 * that reads it, and the pure link builder all need these three facts and none
 * of them should have to import each other to agree on them.
 */

/** Where a partner referral waits between the storefront visit and the booking. */
export const REFERRAL_COOKIE = "diveday_ref";

/**
 * Thirty days. Long enough for the ordinary shape — a guest checks in, browses
 * the shop's schedule from the hotel's page, and books a dive later that week —
 * and short enough that a partner is not still being credited for a diver who
 * has since become the shop's own regular. It is an attribution window, not a
 * session.
 */
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Scoped to the public storefront and nothing else. A referral has no business
 * being sent up with a staff request, a webhook, or an API call, and `/s/` is
 * the whole of the namespace a diver books in (ADR
 * 20260803-public-shop-namespace).
 */
export const REFERRAL_COOKIE_PATH = "/s/";

/**
 * Long enough for "Coral Sands Beach Resort and Dive Lodge", short enough that
 * the column can never be used as free storage. A longer name still produces a
 * link, just a truncated slug — and the slug is the shop's own label for its
 * own link, never a name shown to anybody.
 */
const MAX_SLUG_LENGTH = 64;

/**
 * The partner name a shop typed, as a slug — lowercase, `a-z0-9-`, no leading,
 * trailing or repeated dashes, bounded.
 *
 * Returns null rather than an empty string for anything that slugs to nothing,
 * so "no partner" is one value at every call site instead of two.
 */
export function partnerReferralSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // A slice can land mid-run and leave a trailing dash the first trim removed.
    .replace(/-+$/g, "");
  return slug || null;
}

/**
 * The cookie's value: **which shop's link**, then which partner.
 *
 * The shop half is the whole reason there is an encoding rather than a bare
 * slug. One cookie covers `/s/`, so it travels to every shop's storefront —
 * without the shop bound into it, a guest who opens Coral Sands' link for shop
 * A and then books at shop B hands shop B a partner it has no relationship
 * with, and hands it *by name* a commercial fact about a competitor. That is
 * ordinary browsing, not an attack; turned deliberate it is a way to farm the
 * partner slugs every shop in town is running (security review of issue #1285,
 * finding 1).
 *
 * The check is server-side, in the booking action, rather than resting on the
 * cookie's path: path matching is the browser's promise, and the tenant
 * boundary is ours.
 */
export function encodeReferralCookie(shopSlug: string, partner: string): string {
  return `${shopSlug}:${partner}`;
}

/**
 * The partner in this cookie, but only if it was minted on *this* shop's
 * storefront. Anything else — another shop's referral, a hand-set cookie, an
 * old value from before the encoding — is null, which books exactly as an
 * unreferred visit does.
 */
export function partnerFromReferralCookie(
  value: string | null | undefined,
  shopSlug: string,
): string | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  if (value.slice(0, separator) !== shopSlug) return null;
  return partnerReferralSlug(value.slice(separator + 1));
}

/**
 * Is this request arriving on a partner link?
 *
 * Both halves are required. `utm_source=partner` alone names no partner, and a
 * `utm_campaign` alone is an ordinary campaign parameter a shop may use for
 * anything — only the pair is the link this product generates.
 *
 * `getAll`/single-value, the same shape `src/proxy.ts` already uses for
 * `?embed=`: `get()` silently returns the first of a repeated parameter, which
 * would let a crafted `?utm_source=partner&utm_source=x` mean one thing here
 * and another to a reader that looks at the array.
 */
export function partnerFromSearchParams(params: URLSearchParams): string | null {
  const sources = params.getAll("utm_source");
  if (sources.length !== 1 || sources[0] !== "partner") return null;
  const campaigns = params.getAll("utm_campaign");
  if (campaigns.length !== 1) return null;
  return partnerReferralSlug(campaigns[0]);
}
