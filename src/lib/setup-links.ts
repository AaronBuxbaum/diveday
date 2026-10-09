import { DAY_MS } from "./clock";

/**
 * **A setup link opens `/onboard` for one shop, once** (ADR
 * 20261009-single-use-setup-links).
 *
 * Every shop is still set up by hand (ADR 20260925-shops-are-set-up-by-hand).
 * The form used to open for a standing key, one value for every shop to come,
 * so it could never be sent to a shop. Now each set-up request mints its own
 * link: a random token, stored only as a hash (`shop_setup_links`), that
 * expires and is spent by the shop it creates. The founder receives it in the
 * request's onboarding mail and either fills the form in or forwards it.
 *
 * The token is the same shape as an account token (`account-tokens.ts`): 32
 * random bytes, base64url, hashed with SHA-256.
 */

/** The query parameter the link carries. Redacted from telemetry (`capability-urls.ts`). */
export const SETUP_LINK_PARAM = "setup";

/**
 * Two weeks: long enough for a set-up call to be booked and held, short
 * enough that a link sitting in an inbox does not stay a way in.
 */
export const SETUP_LINK_TTL_MS = 14 * DAY_MS;

/** `/onboard?setup=<token>`: where a setup link opens. */
export function setupLinkPath(token: string): string {
  return `/onboard?${new URLSearchParams({ [SETUP_LINK_PARAM]: token }).toString()}`;
}

/**
 * Whether a request-supplied value could be a token at all: a single string of
 * base64url characters of a token's length. Anything else (a repeated
 * parameter, an uploaded file, a pasted sentence) never reaches the database.
 */
export function isSetupLinkTokenShape(candidate: unknown): candidate is string {
  return typeof candidate === "string" && /^[A-Za-z0-9_-]{43}$/.test(candidate);
}
