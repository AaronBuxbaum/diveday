import type { UsageSample } from "@/lib/cost-guardrails";

/**
 * What every provider usage probe shares: the injected `fetch`, the refusal to
 * reach the network when the fleet has switched external HTTP off, and the two
 * ways a read can come back with no number.
 *
 * **The one rule these adapters exist to enforce: never answer "fine" because
 * you could not look.** Absent credentials are `not_configured`; a credential
 * that is present and still failed is `unavailable`. Both are distinct from
 * `ok` all the way to the alert, the log line, and the response body. Collapsing
 * either into a zero reading would produce a monitor that goes quiet at exactly
 * the moment it is most needed — the state where a bill grows and a green
 * dashboard says nothing is wrong.
 *
 * Environment variable names deliberately carry a `USAGE_` prefix rather than
 * `VERCEL_`/`NEON_`. `VERCEL_` is the namespace Vercel itself injects into
 * every deployment (`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_GIT_*`), and a
 * hand-set variable in a platform-owned namespace is a collision waiting to
 * happen; keeping DiveDay's own keys in one `USAGE_` namespace also makes the
 * whole feature greppable from `.env.example`.
 */

export type Fetcher = typeof fetch;

export type ProbeEnvironment = Readonly<Record<string, string | undefined>>;

export type ProbeOptions = {
  readonly env?: ProbeEnvironment;
  readonly fetcher?: Fetcher;
  /** The instant the sample is being taken at. Callers pass the cron's own `now`. */
  readonly now?: Date;
};

/**
 * Long enough for a usage API doing a range aggregation, short enough that four
 * probes plus the alert still fit comfortably inside the route's `maxDuration`.
 * A provider that has not answered in fifteen seconds is one we cannot measure
 * today, which is a supported state — not a reason to hold a function slot open.
 */
export const PROBE_TIMEOUT_MS = 15_000;

/**
 * Cap on how much of a streamed response body is parsed.
 *
 * The Vercel charges endpoint streams newline-delimited JSON with one row per
 * service per day, so a wide date range on a busy account is unbounded from
 * this side. A daily monitor does not need the tail, and an OOM in a cron is a
 * worse outcome than a slightly short sum — the probe reports `unavailable`
 * rather than a truncated number if it hits this, so a partial read can never
 * masquerade as a low reading.
 */
export const MAX_RESPONSE_ROWS = 20_000;

export function unavailable(reason: string): UsageSample {
  return { status: "unavailable", reason };
}

/**
 * True when this process must not make third-party calls.
 *
 * `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` is set fleet-wide by `playwright.config.ts`
 * so browser tests exercise the whole Next/database stack without waiting on
 * anybody else's API. Matching `src/lib/marine-forecast.ts` and
 * `src/lib/analytics.ts`, the switch only applies to the real `fetch`: a test
 * that injects its own fetcher is exercising this adapter deliberately and is
 * never blocked.
 */
export function externalHttpBlocked(env: ProbeEnvironment, fetcher: Fetcher): boolean {
  return env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" && fetcher === fetch;
}

/**
 * `Authorization: Bearer` plus the timeout and no-store every probe wants.
 * Extracted so a second probe cannot quietly forget the abort signal, which is
 * the difference between a slow provider and a wedged cron.
 */
export function probeRequest(token: string): RequestInit {
  return {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  };
}

/**
 * Map a non-2xx to a machine code an operator can act on without reading a
 * stack trace: `unauthorized` means the token is wrong or expired,
 * `forbidden` means it is valid but lacks the scope, `rate_limited` means back
 * off, `http_<status>` covers the rest. Codes, never sentences (this is
 * `src/lib`).
 */
export function httpFailureReason(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return `http_${status}`;
}
