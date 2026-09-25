/**
 * Telemetry redaction for the browser SDKs.
 *
 * The definition of a capability URL, and the redaction itself, live in
 * `src/lib/capability-urls.ts` — framework-free string logic that
 * `src/lib/analytics.ts` also needs for the server-side seam, and `src/lib`
 * may not import `src/app`. Re-exported here so every existing import (and
 * `observability.test.ts`, which anchors the route list to the `src/app`
 * directories on disk) keeps resolving from the same place it always did.
 */
export {
  CAPABILITY_ROUTE_PREFIXES,
  redactCapabilityUrl,
} from "@/lib/capability-urls";

import type * as Sentry from "@sentry/nextjs";
import { redactCapabilityUrl } from "@/lib/capability-urls";

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

/**
 * A request's query string on its own, through the same redaction as a URL.
 * Sentry's server request-data integration records it apart from `url`, so a
 * capability query parameter (`?setup=`, `?handoff=`, `?preview=`…) left there
 * would reach Sentry even with the URL redacted.
 */
function redactQueryString(
  query: NonNullable<Sentry.ErrorEvent["request"]>["query_string"],
): NonNullable<Sentry.ErrorEvent["request"]>["query_string"] {
  if (typeof query === "string") {
    const bare = query.startsWith("?") ? query.slice(1) : query;
    return redactCapabilityUrl(`/?${bare}`).replace(/^\/\?/, "");
  }
  const pairs = Array.isArray(query) ? query : Object.entries(query ?? {});
  const redacted = new URLSearchParams(
    redactCapabilityUrl(`/?${new URLSearchParams(pairs).toString()}`).replace(/^\/\?/, ""),
  );
  return Array.isArray(query) ? [...redacted.entries()] : Object.fromEntries(redacted.entries());
}

/** Same redaction applied to Sentry event URLs, query strings and referrer header. */
export function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.url) {
    event.request.url = redactCapabilityUrl(event.request.url);
  }
  if (event.request?.query_string) {
    event.request.query_string = redactQueryString(event.request.query_string);
  }
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "referer") headers[key] = redactCapabilityUrl(headers[key]);
    }
  }
  return event;
}
