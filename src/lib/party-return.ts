/**
 * **A parent signing a child's release goes back to their own page** (H-124,
 * dive-domain review F6 of layer r4-1). "Sign Mia's waiver" on the lead's
 * `/ready` hands the lead's own readiness token to the release in this
 * cookie, scoped to that one waiver link's path, so it rides only on the
 * signing post and never in a URL. The waiver action re-checks it
 * (`partyLeadReturnToken`) before it sends anyone anywhere.
 */
export const PARTY_RETURN_COOKIE = "diveday_party_return";

/** The signer's own readiness link, when they opened their release from it. */
export const WAIVER_RETURN_COOKIE = "diveday_waiver_return";

/** An hour: long enough to read and sign a release, short enough to forget. */
export const PARTY_RETURN_MAX_AGE_SECONDS = 60 * 60;

/** Production cookies require HTTPS; the e2e fleet uses HTTP loopback. */
export function partyReturnCookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.DIVEDAY_E2E !== "1";
}

/** The one path the cookie is sent on: the release the parent was handed. */
export function partyReturnCookiePath(waiverToken: string): string {
  return `/waivers/${waiverToken}`;
}
