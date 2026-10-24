import { publicAppUrl } from "@/lib/notifications/app-url";

/**
 * **Whether a cookie-authenticated route handler should refuse a request as
 * coming from another site** (security review 2, L5). Server actions get
 * Next's own origin check; a route handler gets none, so a state-changing
 * one that trusts the session cookie asks this first. SameSite=Lax session
 * cookies already keep a cross-site POST from carrying the session, so this
 * is defense in depth against a later cookie-policy change.
 *
 * Its own origin is the request's, or DiveDay's public one (`publicAppUrl`);
 * what is refused is `crossSite`'s rule, below.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const own = new URL(request.url).origin;
  return crossSite(request.headers, (origin) => origin === own || isPublicOrigin(origin));
}

/**
 * **The same question for a server action or a page render**, which see the
 * request's headers but not its URL (security review of #2990, M1 and L1).
 * The print with medical alerts asks it before it reads or records anything,
 * and the emergency read's action before it reads the session.
 *
 * Its own origin is the host the request was sent to (`x-forwarded-host`,
 * then `host`) or DiveDay's public one (`publicAppUrl`), so a proxy that
 * rewrites `Host` without setting `x-forwarded-host` does not refuse the
 * app's own call.
 */
export function isCrossSiteHeaders(headers: HeaderReader): boolean {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  return crossSite(
    headers,
    (origin) => (host !== null && hostOf(origin) === host) || isPublicOrigin(origin),
  );
}

type HeaderReader = { get(name: string): string | null };

/**
 * One rule for both. Refused: `Sec-Fetch-Site: cross-site`; an `Origin` that
 * is not the app's own (the opaque `null` included); a `same-site` request
 * (a sibling host) that does not show it came from the app's own pages; and,
 * with no fetch metadata at all, a `Referer` from somewhere else. A
 * same-origin request, a typed or bookmarked URL (`none`) and a bare
 * request with no `Origin` (a non-browser client, which carries no
 * victim's cookie) go on to the session check.
 */
function crossSite(headers: HeaderReader, isOwn: (origin: string) => boolean): boolean {
  const site = headers.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = headers.get("origin");
  if (origin !== null) return !isOwn(origin);
  if (site === "same-origin" || site === "none") return false;
  const referer = headers.get("referer");
  const fromElsewhere = referer !== null && !isOwn(originOf(referer));
  if (site === "same-site") return referer === null || fromElsewhere;
  return fromElsewhere;
}

function isPublicOrigin(origin: string): boolean {
  const configured = publicAppUrl();
  return configured !== null && origin === configured;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "null";
  }
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
