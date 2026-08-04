/**
 * Bearer-capability routes whose path segment after the prefix is a
 * replayable credential, never an identifier safe to leave in telemetry.
 */
const CAPABILITY_ROUTE_PREFIXES = [
  "waivers",
  "ready",
  "recap",
  // Account-lifecycle tokens (20260725-account-lifecycle-emails):
  // /verify/[token] and /reset-password/[token]. /forgot-password carries no
  // token in its URL (the email is a POST body field), so it needs none of
  // this.
  "verify",
  "reset-password",
  // Staff-invite acceptance token (20260726-staff-invite-accounts).
  "invite",
  // Party seat-claim token (20260804-seat-claim-links): /claim/[token] lets
  // one party member take over one seat, so a leaked copy is a working
  // identity-takeover link for that seat until it is used or revoked.
  "claim",
  // Staff calendar-subscription feed token (ADR
  // 20260730-calendar-feed-subscriptions, owned by src/features/calendar-sync).
  // `/calendar/[token]` sits outside `/shop` so no session gate applies and the
  // URL *is* the capability — its own route handler says so verbatim. It is the
  // longest-lived credential of the set: a calendar client re-fetches the same
  // URL unattended for as long as the subscription exists, so one leaked copy
  // in telemetry replays the whole shop's schedule indefinitely.
  "calendar",
] as const;

/**
 * Query parameters that carry a bearer capability token directly, rather than
 * as a path segment — the schedule-confirmation page's `?booking=<token>`
 * (CR-002/CR-003's `confirm` capability, minted by `issueBookingCapability`
 * and threaded through `src/app/s/[shopSlug]/trips/[id]/actions.ts`,
 * including Stripe's checkout return URL). A security review of the original
 * CR-001 fix found this token reaching Analytics/Speed Insights unredacted —
 * the path-prefix check alone never inspects query parameters at all, and
 * `/s/[shopSlug]/trips/[id]` doesn't match any capability prefix. Same
 * "value is a replayable credential" reasoning as the path prefixes above,
 * checked independently of them so it still catches the token even on a path
 * that isn't itself capability-prefixed.
 */
const CAPABILITY_QUERY_PARAMS = ["booking"] as const;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Rewrites any `CAPABILITY_ROUTE_PREFIXES` path — `/waivers/<token>`,
 * `/ready/<token>`, `/recap/<token>`, `/verify/<token>`,
 * `/reset-password/<token>`, `/invite/<token>`, `/claim/<token>`,
 * `/calendar/<token>` (and any
 * URL-encoded variant of those prefixes) — to its template form, and
 * redacts any `CAPABILITY_QUERY_PARAMS` value on *any* path, so
 * Analytics/Speed Insights never receive a raw capability regardless of
 * whether it travels as a path segment or a query parameter. Fails closed on
 * an unparseable URL — better to drop a URL we can't inspect than risk
 * forwarding a token we failed to recognize.
 */
export function redactCapabilityUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl, "https://redact.invalid");
  } catch {
    return "[unparseable]";
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments.length >= 2 ? decodeSegment(segments[0] ?? "").toLowerCase() : "";
  const prefix = CAPABILITY_ROUTE_PREFIXES.find((candidate) => candidate === first);
  if (prefix) return `/${prefix}/[token]`;

  let redactedQuery = false;
  for (const param of CAPABILITY_QUERY_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, "[token]");
      redactedQuery = true;
    }
  }
  return redactedQuery ? `${url.pathname}${url.search}` : rawUrl;
}

import type * as Sentry from "@sentry/nextjs";

/** Same redaction applied to Sentry breadcrumbs (navigation, fetch, xhr). */
export function redactBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  if (breadcrumb.category === "navigation") {
    if (typeof data.from === "string") data.from = redactCapabilityUrl(data.from);
    if (typeof data.to === "string") data.to = redactCapabilityUrl(data.to);
  }
  if (
    (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") &&
    typeof data.url === "string"
  ) {
    data.url = redactCapabilityUrl(data.url);
  }
  return breadcrumb;
}

/** Same redaction applied to Sentry event URLs and referrer header. */
export function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) {
    event.request.url = redactCapabilityUrl(event.request.url);
  }
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "referer") headers[key] = redactCapabilityUrl(headers[key]);
    }
  }
  return event;
}
