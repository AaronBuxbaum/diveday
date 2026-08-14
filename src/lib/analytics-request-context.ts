/**
 * Capability-URL redaction for **server-side** analytics.
 *
 * `src/app/observability-client.tsx` is the seam for every telemetry client
 * that runs in the browser, and every one of them is wrapped so
 * `redactCapabilityUrl` edits the event before it leaves. That seam has no
 * authority over anything sent server to server, and there is exactly one such
 * sender: `trackEvent` (`src/lib/analytics.ts`) calling `track` from
 * `@vercel/analytics/server`.
 *
 * That SDK composes the event's page URL **itself**. From its own source:
 *
 * ```js
 * const requestContext = globalThis[Symbol.for("@vercel/request-context")]?.get();
 * ...
 * o: requestContext?.url || tmp.referer || new URL(url).origin,
 * ```
 *
 * `o` is the page the event happened on, `requestContext.url` wins over every
 * fallback, and `track(name, props, options)` exposes no parameter that reaches
 * it. So there is nothing to redact at the DiveDay call site — the value is not
 * one this code ever holds.
 *
 * DiveDay has pages where the URL **is** the credential: `/waivers/[token]`,
 * `/ready/[token]`, `/recap/[token]`, `/claim/[token]`, `/calendar/[token]`,
 * and the not-path-shaped `?booking=<token>` confirm URL. `trackEvent` is called
 * while rendering three of them — `waiver_signed` from the waiver page,
 * `booking_cancelled`/`refund_issued` from `/ready`'s actions, `seat_claimed`
 * from the seat-claim path — so those raw capability URLs were reaching Vercel
 * Analytics in the clear. Found by a security review on 2026-08-14.
 *
 * ## The fix, and why it is a wrapper rather than a patch
 *
 * The request context is a plain object on `globalThis`, so this installs a
 * **delegating shim**: `get()` calls through to whatever the runtime put there
 * and returns the same context with `url` passed through `redactCapabilityUrl`
 * — the very function the browser SDKs use, so both halves of the app redact
 * identically and there is one definition of "capability URL" to maintain.
 *
 * Delegating rather than swapping matters. Installed once, it is correct for
 * every request forever, so there is no per-call swap to race: concurrent
 * requests each read their own context through the same wrapper. A
 * save-call-restore around one `await` would corrupt a neighbour's context, and
 * that neighbour is another diver's page load.
 *
 * It also fixes the *class*, not the instance. Any future server-side Vercel
 * event — added by someone who never reads this file — is redacted by
 * construction, which is the property the browser seam has and the reason this
 * leak was possible at all: the rule was written as "one file", and a file has
 * no authority over a server-to-server call.
 *
 * ## What this deliberately does not do
 *
 * It does not stop the events, drop properties, or change what is measured. The
 * leak is the *credential in the URL*, not the fact of the measurement — a
 * `waiver_signed` count with a redacted page URL is exactly as useful and gives
 * an ad platform or a dashboard reader nothing they can use to open a waiver.
 *
 * ## The contract this depends on
 *
 * `Symbol.for("@vercel/request-context")` and the `{ get(): { url } }` shape are
 * **internal** to Vercel's runtime — not a documented public API. If an upgrade
 * changes either, this silently stops redacting, which is the same silent
 * failure it exists to prevent. `analytics-request-context.test.ts` pins the
 * shape, and `installCapabilityUrlRedaction` reports whether it found anything
 * to wrap so a deploy check can assert it did.
 */
import { redactCapabilityUrl } from "./capability-urls";

/** The runtime's own key for the per-request context. */
const REQUEST_CONTEXT_SYMBOL = Symbol.for("@vercel/request-context");

/** The shape this depends on — deliberately minimal, and asserted by the test. */
type VercelRequestContext = { url?: string };
type VercelRequestContextHolder = { get: () => VercelRequestContext | undefined };

/** Marks a holder as already wrapped, so a double install cannot nest shims. */
const WRAPPED = Symbol.for("diveday.capability-url-redaction");

type Wrappable = VercelRequestContextHolder & { [WRAPPED]?: true };

/**
 * Wrap a request-context holder so every read of it reports a redacted `url`.
 *
 * Exported for the test: the real holder only exists inside Vercel's runtime,
 * so the shim is exercised against a stand-in that matches the shape above.
 */
export function redactingHolder(holder: VercelRequestContextHolder): VercelRequestContextHolder {
  const wrappable = holder as Wrappable;
  if (wrappable[WRAPPED]) return holder;
  const wrapped: Wrappable = {
    ...holder,
    get: () => {
      const context = holder.get();
      if (!context || typeof context.url !== "string") return context;
      // Spread rather than mutate: the runtime hands the *same* context object
      // to everything else that reads it (`waitUntil` and friends live on it),
      // and rewriting a field in place would edit their view too.
      return { ...context, url: redactCapabilityUrl(context.url) };
    },
    [WRAPPED]: true,
  };
  return wrapped;
}

/**
 * Install the redaction, returning whether a holder was there to wrap.
 *
 * `false` is not an error on its own — outside Vercel's runtime (dev, tests,
 * any self-hosted target) nothing sets the global, and there is correspondingly
 * nothing that could leak. It is only a problem in production, which is what
 * makes it worth returning rather than swallowing.
 */
export function installCapabilityUrlRedaction(scope: Record<PropertyKey, unknown> = globalThis): {
  installed: boolean;
} {
  const holder = scope[REQUEST_CONTEXT_SYMBOL] as VercelRequestContextHolder | undefined;
  if (!holder || typeof holder.get !== "function") return { installed: false };
  scope[REQUEST_CONTEXT_SYMBOL] = redactingHolder(holder);
  return { installed: true };
}
