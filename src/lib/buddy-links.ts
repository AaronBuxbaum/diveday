/**
 * **The buddy seat** (ADR 20260908-one-hand, decision 6, lever W).
 *
 * A diver's recap ends on "Bring a buddy next time", which is a link to the
 * shop carrying a non-secret id derived from that diver's own booking. The
 * friend books their own seat and signs their own waiver; the shop is told how
 * many seats arrived that way and nothing else. No discount, no code, no
 * reward — the roadmap's referral-*program* call stays parked, and this is only
 * the door, counted.
 *
 * **No server imports, deliberately** — the same rule `src/lib/referrals.ts`
 * states and for the same reason: `src/proxy.ts` runs at the edge, where
 * `node:crypto` does not exist. So this module holds the three facts the edge,
 * the booking action and the recap page all need — the cookie, the parameter,
 * and the shape of the id — and the signing half lives one file over in
 * `src/lib/buddy-tokens.ts`, which only Node reads.
 *
 * The edge therefore checks the *shape* and the shop; the booking action checks
 * the *signature* before anything is credited. That split is deliberate rather
 * than a compromise: a cookie is not a credential here, and the only thing a
 * forged one can buy is a referral that fails to verify a moment later.
 */

/** Where a buddy referral waits between the storefront visit and the booking. */
export const BUDDY_COOKIE = "diveday_via";

/** The search parameter a recap's buddy link carries. */
export const BUDDY_PARAM = "via";

/** Thirty days — the attribution window `REFERRAL_COOKIE_MAX_AGE` already sets for partners. */
export const BUDDY_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Scoped to the public storefront, like every other thing a diver's visit carries. */
export const BUDDY_COOKIE_PATH = "/s/";

/**
 * A referral id is `<22 base64url characters>.<16 base64url characters>` — a
 * packed booking uuid and a truncated HMAC tag (`src/lib/buddy-tokens.ts`).
 * Fixed length and fixed charset, so anything else is refused before it is
 * stored, hashed or compared. This is the *only* validation the edge does.
 */
const BUDDY_REFERRAL_ID = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}$/;

/** Is this string shaped like a referral id? Says nothing about whether it verifies. */
export function isBuddyReferralIdShape(candidate: string | null | undefined): boolean {
  return Boolean(candidate) && BUDDY_REFERRAL_ID.test(candidate as string);
}

/**
 * The cookie's value: **which shop's link**, then the id — exactly the encoding
 * `src/lib/referrals.ts` carries, and for exactly its reason. One cookie covers
 * `/s/`, so a diver who opened shop A's buddy link and then books at shop B
 * would otherwise hand shop B a referral minted somewhere else. The check is
 * server-side, in the booking action; the cookie's path is the browser's
 * promise, and the tenant boundary is ours.
 */
export function encodeBuddyCookie(shopSlug: string, referralId: string): string {
  return `${shopSlug}:${referralId}`;
}

/** The referral id in this cookie, but only if it was minted on *this* shop's storefront. */
export function buddyReferralFromCookie(
  value: string | null | undefined,
  shopSlug: string,
): string | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  if (value.slice(0, separator) !== shopSlug) return null;
  const candidate = value.slice(separator + 1);
  return isBuddyReferralIdShape(candidate) ? candidate : null;
}

/**
 * The `?via=` a request arrives on, when it is shaped like one.
 *
 * `getAll`/single-value, the same shape `partnerFromSearchParams` uses: `get()`
 * silently returns the first of a repeated parameter, which would let a crafted
 * `?via=a&via=b` mean one thing here and another to a reader that looks at the
 * array.
 */
export function buddyReferralFromSearchParams(params: URLSearchParams): string | null {
  const values = params.getAll(BUDDY_PARAM);
  if (values.length !== 1) return null;
  const candidate = values[0];
  return isBuddyReferralIdShape(candidate) ? (candidate as string) : null;
}
