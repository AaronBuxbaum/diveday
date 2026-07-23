/**
 * Bearer-capability routes whose path segment after the prefix is a
 * replayable credential, never an identifier safe to leave in telemetry.
 */
const CAPABILITY_ROUTE_PREFIXES = ["waivers", "ready", "recap"] as const;

/**
 * Query parameters that carry a bearer capability token directly, rather than
 * as a path segment — the schedule-confirmation page's `?booking=<token>`
 * (CR-002/CR-003's `confirm` capability, minted by `issueBookingCapability`
 * and threaded through `src/app/shop/[shopSlug]/schedule/[id]/actions.ts`,
 * including Stripe's checkout return URL). A security review of the original
 * CR-001 fix found this token reaching Analytics/Speed Insights unredacted —
 * the path-prefix check alone never inspects query parameters at all, and
 * `/shop/[shopSlug]/schedule/[id]` doesn't match any capability prefix. Same
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
 * Rewrites `/waivers/<token>`, `/ready/<token>`, and `/recap/<token>` (and
 * any URL-encoded variant of those prefixes) to their template form, and
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
