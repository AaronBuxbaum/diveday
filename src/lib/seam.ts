/**
 * **The four lines every outbound seam needs** (issue #2779): an environment
 * to read, a `fetch` to inject, and the one answer to "has the fleet switched
 * external HTTP off?". A seam is a module that talks to somebody else's API
 * (usage probes, the marine forecast, analytics, a pasted image URL); each used
 * to spell these itself.
 */

/** A process environment, or a test's stand-in for one. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** The injectable `fetch` of a seam. */
export type Fetch = typeof fetch;

/**
 * True when this process must not make third-party calls.
 *
 * `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` is set fleet-wide by `playwright.config.ts`
 * so browser tests exercise the whole Next/database stack without waiting on
 * anybody else's API. The switch only applies to the real thing: a test that
 * injects its own `fetch` (or tracker, or DNS lookup) is exercising the adapter
 * deliberately and is never blocked. So the caller names what it was given
 * (`using`) and what the default would have been (`real`, which is `fetch`
 * unless the seam's outbound call is something else).
 */
export function externalHttpBlocked(
  env: Environment,
  using: unknown,
  real: unknown = fetch,
): boolean {
  return env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" && using === real;
}
