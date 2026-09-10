import { DAY_MS } from "@/lib/clock";
import { createBearerToken, hashBearerToken } from "./bearer-tokens";

/**
 * **The diver's shelf, as a link and as a cookie.**
 *
 * The shelf (`/shelf/[token]`) is the one bearer surface anchored to a person
 * rather than to a booking, so its lifetime is not derived from a trip the way
 * `src/lib/booking-capabilities.ts` derives every other one. The two facts here
 * are its lifetime and its two path strings; the row it verifies against lives
 * in `src/db/person-shelf-tokens.ts`.
 *
 * **Stored, not signed** — see `personShelfTokens` in `src/db/schema.ts` for
 * why. This module only names the primitive; it deliberately holds no policy
 * about revocation, which is the database's.
 */

/**
 * A year. Longer than a dive season, so a diver who comes back each January
 * finds the link on their phone still working; shorter than the life of a
 * phone, so a link that stopped being used stops working rather than standing
 * open forever. The shop mints another in one tap from the diver's record.
 */
export const SHELF_TOKEN_TTL_MS = 365 * DAY_MS;

export const createShelfToken = createBearerToken;

export const hashShelfToken = hashBearerToken;

/** The absolute-path shelf link for an already-issued token. */
export function shelfLinkPath(token: string): string {
  return `/shelf/${token}`;
}

/**
 * Where the shelf's token waits between the diver opening it and the shop's
 * storefront greeting them.
 *
 * One name, many paths: the cookie is written at `/s/<slug>` (below), so a
 * diver who dives with two shops in one town carries one cookie per shop and
 * the browser sends each only to the shop it belongs to.
 */
export const SHELF_COOKIE = "diveday_shelf";

/**
 * A season. The storefront's greeting is a courtesy, not a session: a diver who
 * has not opened a shop's pages for half a year is greeted cold again, and the
 * link on their phone still opens the shelf, which is where the greeting comes
 * back from.
 */
export const SHELF_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

/**
 * Scoped to one shop's storefront and nothing else.
 *
 * The referral cookie (`src/lib/referrals.ts`) covers the whole `/s/` namespace
 * and carries the shop in its *value* so a cross-shop read can be refused. This
 * one narrows the path instead, because what it carries is a live capability
 * over a person's file rather than a partner's slug: a browser that never sends
 * it to another shop is one fewer place the token can be read.
 *
 * That is the browser's promise, not ours, so it is never the check. The token
 * itself is scoped to (shop, person) in the database and the storefront
 * re-checks the shop it resolved against its own — see `readShelfCookie`.
 */
export function shelfCookiePath(shopSlug: string): string {
  return `/s/${shopSlug}`;
}
