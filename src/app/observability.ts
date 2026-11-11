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

/** Scrub recognizable credentials, not names, email addresses or diagnostic context.
 * Unlabelled strings cannot be identified as passwords: callers must never log them.
 * An unquoted password assignment consumes the rest of its line: whitespace and
 * punctuation may be part of the password, so preserving that suffix is unsafe.
 */
function redactDiagnosticText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+|\/[^\s<>"']+/gi, (url) => redactCapabilityUrl(url))
    .replace(
      /(\b(?:password|current[_-]?password|new[_-]?password|confirm[_-]?password|owner[_-]?password)\b["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]+)/gi,
      "$1[redacted]",
    );
}

function redactDiagnosticValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === "string") return redactDiagnosticText(value);
  if (typeof value === "function") return "[function]";
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? value.toString() : value.toISOString();
  if (value instanceof URL) return redactDiagnosticText(value.href);
  if (seen.has(value)) return seen.get(value);
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  if (value instanceof Error) {
    Object.assign(copy, {
      name: redactDiagnosticText(value.name),
      message: redactDiagnosticText(value.message),
      stack: value.stack && redactDiagnosticText(value.stack),
      ...(value.cause === undefined ? {} : { cause: redactDiagnosticValue(value.cause, seen) }),
    });
  }

  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const child = descriptor && "value" in descriptor ? descriptor.value : "[accessor]";
    Object.defineProperty(copy, key, {
      value:
        /^(?:password|current[_-]?password|new[_-]?password|confirm[_-]?password|owner[_-]?password)$/i.test(
          key,
        )
          ? "[redacted]"
          : redactDiagnosticValue(child, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

/**
 * Capability URLs taken out of Sentry breadcrumbs (navigation, fetch, xhr).
 * Console breadcrumbs keep diagnostic context but redact recognizable credentials.
 */
export function redactBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  breadcrumb = redactDiagnosticValue(breadcrumb) as Sentry.Breadcrumb;
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
 * Exception messages and stacks retain context after credential redaction.
 */
export function redactEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  event = redactDiagnosticValue(event) as Sentry.ErrorEvent;
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
