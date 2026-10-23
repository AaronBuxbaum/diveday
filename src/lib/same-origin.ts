import { publicAppUrl } from "@/lib/notifications/app-url";

/**
 * **Whether a cookie-authenticated route handler should refuse a request as
 * coming from another site** (security review 2, L5). Server actions get
 * Next's own origin check; a route handler gets none, so a state-changing
 * one that trusts the session cookie asks this first. SameSite=Lax session
 * cookies already keep a cross-site POST from carrying the session, so this
 * is defense in depth against a later cookie-policy change.
 *
 * Refused: a `Sec-Fetch-Site: cross-site` request, and any request whose
 * `Origin` header is present and is neither the request's own origin nor
 * DiveDay's public one (`publicAppUrl`), including the opaque `null`. A
 * request with no `Origin` (a non-browser client, which carries no victim's
 * cookie) is let through to the session check.
 */
export function isCrossSiteRequest(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const own = new Set([new URL(request.url).origin]);
  const configured = publicAppUrl();
  if (configured) own.add(configured);
  return !own.has(origin);
}
