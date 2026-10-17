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
import { errorCodeToken } from "@/lib/error-token";

/** What an exception's or a logged line's text becomes: the text is gone. */
const REDACTED_MESSAGE = "[redacted]";

/**
 * React's production build throws `Minified React error #418; visit
 * https://react.dev/errors/418?args[]=… for the full message`. The number is
 * the diagnosis and says nothing about anybody; the link's arguments can carry
 * rendered text, so only the number is kept.
 */
const MINIFIED_REACT_ERROR = /^Minified React error #\d+/;

/** A message's text replaced, unless it is a minified React error's number. */
function redactedText(text: string | undefined): string {
  return text?.match(MINIFIED_REACT_ERROR)?.[0] ?? REDACTED_MESSAGE;
}

/**
 * Same redaction applied to Sentry breadcrumbs (navigation, fetch, xhr), and a
 * console breadcrumb's text and arguments dropped: a logged line is often the
 * very error text `redactEvent` scrubs from the exception (security review of
 * issue #2531).
 */
export function redactBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (breadcrumb.category === "console") {
    if (breadcrumb.message !== undefined) breadcrumb.message = redactedText(breadcrumb.message);
    if (breadcrumb.data) delete breadcrumb.data.arguments;
  }
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
 * What the Sentry SDKs collect on their own, for both `Sentry.init` calls
 * (`src/instrumentation.ts`, `src/instrumentation-client.ts`). @sentry/core 11
 * defaults every one of these on (`resolveDataCollectionOptions`): request and
 * response bodies, cookies, the user's IP and identity, local variables in
 * stack frames and database query values. A Stripe webhook body carries a
 * customer's name, email and address, a server action's carries a form, and a
 * cookie is a session (issue #2334, security review). Headers and query strings
 * stay on, cleaned by `redactEvent`, because they are how an error is placed.
 */
export const SENTRY_DATA_COLLECTION = {
  httpBodies: [],
  cookies: false,
  userInfo: false,
  stackFrameVariables: false,
  databaseQueryData: false,
} satisfies NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"];

/** Request headers that carry a credential, compared lower-cased. */
const CREDENTIAL_HEADERS = new Set(["cookie", "authorization", "stripe-signature"]);

/**
 * Request headers that carry the client's IP address, compared lower-cased
 * (issue #2531). An address is personal data and places no error.
 */
const CLIENT_ADDRESS_HEADERS = new Set([
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "x-cluster-client-ip",
]);

/**
 * Every exception's message replaced (issue #2531). A message can quote
 * whatever the failing call was handed: a bounce's recipient, a driver's bound
 * parameters, a provider's free text. The class is already the exception's
 * `type`; the thrown error's own code, or its cause's (`23505`, `ECONNRESET`),
 * is kept on the outermost one when it has the shape of a code. A minified
 * React error keeps its number (`redactedText`).
 */
function redactException(event: Sentry.ErrorEvent, hint: Sentry.EventHint | undefined) {
  const values = event.exception?.values;
  if (!values?.length) return;
  const code = hint ? errorCodeToken(hint.originalException) : undefined;
  values.forEach((value, index) => {
    const outermost = index === values.length - 1;
    const text = redactedText(value.value);
    value.value = outermost && code && text === REDACTED_MESSAGE ? `${text} ${code}` : text;
  });
}

/**
 * Redaction applied to every Sentry event: the text of every exception,
 * capability URLs in the URL, query string and referer, and nothing of the
 * request that can carry a person or a credential. The body, cookies and
 * environment are deleted outright and the credential and client-address
 * headers dropped, the second layer behind `SENTRY_DATA_COLLECTION` for
 * anything an integration attaches regardless.
 */
export function redactEvent(event: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent {
  redactException(event, hint);
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
      if (CREDENTIAL_HEADERS.has(name) || CLIENT_ADDRESS_HEADERS.has(name)) delete headers[key];
      else if (name === "referer") headers[key] = redactCapabilityUrl(headers[key]);
    }
  }
  return event;
}
