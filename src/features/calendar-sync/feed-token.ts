import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";

/**
 * The credential half of a calendar subscription. Pure and framework-free so
 * the token shape can be tested without a database or a request.
 */

export const createFeedToken = createBearerToken;

export const hashFeedToken = hashBearerToken;

/**
 * How often a subscribing client is *asked* to re-poll. Advisory only — Google
 * in particular refetches on its own schedule (often hours), which is why the
 * staff UI must not promise near-real-time sync.
 */
export const FEED_REFRESH_MINUTES = 60;

/** The feed's absolute path. Outside `/shop`, so no session gate applies. */
export function feedPath(token: string): string {
  return `/calendar/${token}.ics`;
}

/**
 * The subscribe URL for a calendar client. `webcal:` is not a real scheme —
 * it is an https fetch with a different protocol word — but Apple Calendar and
 * Outlook use it to mean "subscribe and keep polling" rather than "download
 * this file once", which is the entire difference between a live calendar and
 * a frozen snapshot. Google ignores the scheme and takes the https form, so
 * the UI offers both.
 */
export function feedSubscribeUrl(origin: string, token: string): string {
  return `${origin.replace(/^https?:/, "webcal:")}${feedPath(token)}`;
}

/**
 * Recovers the raw token from a feed request path. The `.ics` suffix exists
 * only because some clients refuse a subscription URL without one, so it is
 * optional on the way back in.
 */
export function tokenFromFeedSegment(segment: string): string {
  return segment.endsWith(".ics") ? segment.slice(0, -".ics".length) : segment;
}
