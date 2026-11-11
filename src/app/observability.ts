/**
 * What leaves for Sentry and the other telemetry vendors.
 *
 * Errors keep their message, stack, route, query string and breadcrumbs: an
 * error you cannot read cannot be fixed. Only what is a credential or a
 * capability link is taken out: the capability URLs below, cookies, and the
 * authorization and signature headers.
 *
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

/**
 * Capability URLs taken out of Sentry breadcrumbs (navigation, fetch, xhr).
 * Console breadcrumbs stay whole: the line logged just before a crash is often
 * the best clue to it.
 */
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

/**
 * What the Sentry SDKs collect, for both `Sentry.init` calls
 * (`src/instrumentation.ts`, `src/app/sentry-client.ts`). Request and response
 * bodies and cookies stay off: a body can be a login or card form or a Stripe
 * webhook, and a cookie is a session. Who was signed in (`userInfo`) is on, so
 * an error names the person and shop it happened to. Headers and query strings
 * stay on, cleaned by `redactEvent`, because they are how an error is placed.
 */
export const SENTRY_DATA_COLLECTION = {
  httpBodies: [],
  cookies: false,
  userInfo: true,
  stackFrameVariables: false,
  databaseQueryData: false,
} satisfies NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"];

/** Request headers that carry a credential, compared lower-cased. */
const CREDENTIAL_HEADERS = new Set(["cookie", "authorization", "stripe-signature"]);

/**
 * Redaction applied to every Sentry event: capability URLs in the URL, query
 * string and referer taken out, and the body, cookies, environment and
 * credential headers deleted outright, the second layer behind
 * `SENTRY_DATA_COLLECTION` for anything an integration attaches regardless.
 * Exception messages, stacks and the client's address are left alone.
 */
export function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const request = event.request;
  if (!request) return event;
  if (request.url) {
    request.url = redactCapabilityUrl(request.url);
  }
  if (request.query_string) {
    request.query_string = redactQueryString(request.query_string);
  }
  delete request.data;
  delete request.cookies;
  delete request.env;
  const headers = request.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      const name = key.toLowerCase();
      if (CREDENTIAL_HEADERS.has(name)) delete headers[key];
      else if (name === "referer") headers[key] = redactCapabilityUrl(headers[key]);
    }
  }
  return event;
}
