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
 * ## Why the shim is installed onto the holder rather than over the global
 *
 * The obvious install is `globalThis[SYMBOL] = redactingHolder(holder)`. That is
 * what shipped, and on Vercel it **throws**: the runtime defines that slot as a
 * non-writable data property, so the assignment is a `TypeError` in strict mode
 * ("Cannot assign to read only property 'Symbol(@vercel/request-context)'").
 * Every server-side event died on it for a day — out of `after()` callbacks as a
 * logged error, and out of `authorize()`'s `void trackEvent(...)` as an unhandled
 * rejection that took a sign-in to a 504.
 *
 * The holder sitting *in* that read-only slot is an ordinary object, though, so
 * its `get` can be swapped in place. That is now the first strategy, and it is
 * the better one regardless: anything that captured the holder before this ran
 * reads through the shim too, where replacing the slot would have left it
 * looking at the raw context.
 *
 * ## The contract this depends on
 *
 * `Symbol.for("@vercel/request-context")` and the `{ get(): { url } }` shape are
 * **internal** to Vercel's runtime — not a documented public API. If an upgrade
 * changes either, this silently stops redacting, which is the same silent
 * failure it exists to prevent. `analytics-request-context.test.ts` pins the
 * shape, and `installCapabilityUrlRedaction` reports which of the three things
 * happened so its caller can fail closed on the one that matters.
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
  // Bound *now*, not read through `holder.get` at call time: the install below
  // assigns this shim's `get` back onto the same holder, and a late read would
  // then find the shim and recurse forever.
  const read = holder.get.bind(holder);
  const wrapped: Wrappable = {
    ...holder,
    get: () => {
      const context = read();
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
 * Whether `key` on `target` can be overwritten without throwing.
 *
 * Asked rather than attempted: this runs on the path that must never throw, and
 * a descriptor check says the same thing as a `try`/`catch` without turning a
 * genuine bug elsewhere into a swallowed one.
 */
function isOverwritable(target: object, key: PropertyKey): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) return Object.isExtensible(target);
  return descriptor.writable === true;
}

/**
 * How the install went.
 *
 * `absent` is the normal answer off Vercel — dev, tests, any self-hosted target
 * never sets the global, and there is correspondingly nothing that could leak.
 * `failed` means a real request context is there and could **not** be wrapped,
 * which is the only one a caller must act on: see `trackEvent`, which drops the
 * event rather than let the SDK compose a page URL out of a live capability
 * token.
 */
export type RedactionInstall = "absent" | "installed" | "failed";

/**
 * Install the redaction. Never throws: this runs inside telemetry, which may
 * not take down the flow it observes, and the assignment it used to do did
 * exactly that on Vercel (see the note on the read-only slot above).
 */
export function installCapabilityUrlRedaction(scope: Record<PropertyKey, unknown> = globalThis): {
  status: RedactionInstall;
} {
  const holder = scope[REQUEST_CONTEXT_SYMBOL] as Wrappable | undefined;
  if (!holder || typeof holder.get !== "function") return { status: "absent" };
  if (holder[WRAPPED]) return { status: "installed" };
  const wrapped = redactingHolder(holder) as Wrappable;

  // Swap the holder's own `get`, which is what works on Vercel and what keeps
  // an already-captured holder reference redacted.
  if (isOverwritable(holder, "get") && Object.isExtensible(holder)) {
    holder.get = wrapped.get;
    holder[WRAPPED] = true;
    return { status: "installed" };
  }
  // A frozen holder in a writable slot: swap the whole holder instead.
  if (isOverwritable(scope, REQUEST_CONTEXT_SYMBOL)) {
    scope[REQUEST_CONTEXT_SYMBOL] = wrapped;
    return { status: "installed" };
  }
  return { status: "failed" };
}
