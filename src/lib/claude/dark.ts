/**
 * **When an assist is dark** (ADR 20261018-claude-assists): it answers "no
 * assist" and the feature behind it works exactly as it does without Claude.
 * Dark is a normal state, never an error a caller has to catch.
 *
 * Five conditions, checked cheapest first so the reason logged is the one an
 * operator can act on soonest:
 *
 * - `no_key`: `ANTHROPIC_API_KEY` is unset (a fork, a local run, CI).
 * - `external_http_disabled`: `DIVEDAY_DISABLE_EXTERNAL_HTTP=1`, which
 *   Playwright sets fleet-wide, so every browser test runs dark.
 * - `shop_off`: the shop switched "Claude suggestions" off in Features.
 * - `demo_shop`: a demo tenant. Anyone can mint one from the public demo
 *   door, so a per-shop cap would be no cap at all: each visitor would get a
 *   fresh $15 of somebody else's money.
 * - `over_cap`: the shop's spend this UTC calendar month reached its cap.
 */
export const ASSIST_DARK_REASONS = [
  "no_key",
  "external_http_disabled",
  "shop_off",
  "demo_shop",
  "over_cap",
] as const;
export type AssistDarkReason = (typeof ASSIST_DARK_REASONS)[number];

export type AssistConditions = {
  readonly hasKey: boolean;
  readonly externalHttpDisabled: boolean;
  readonly shopEnabled: boolean;
  /** Absent means a real shop. */
  readonly shopIsDemo?: boolean;
  /** The shop's recorded spend this calendar month. */
  readonly spentMicroUsd: number;
  readonly capMicroUsd: number;
};

/** Why the assist is dark, or null when it may run. */
export function assistDarkReason(conditions: AssistConditions): AssistDarkReason | null {
  if (!conditions.hasKey) return "no_key";
  if (conditions.externalHttpDisabled) return "external_http_disabled";
  if (!conditions.shopEnabled) return "shop_off";
  if (conditions.shopIsDemo) return "demo_shop";
  const spent = conditions.spentMicroUsd;
  // A spend we could not read is not a spend of zero: the cap fails closed.
  if (!Number.isFinite(spent) || spent < 0) return "over_cap";
  if (spent >= conditions.capMicroUsd) return "over_cap";
  return null;
}

/**
 * The per-shop monthly cap, in USD. At the volumes in the build plan a busy
 * shop spends a few dollars a month; $15 leaves room for a month of heavy
 * onboarding and stops a loop long before it is a bill anyone notices.
 */
export const DEFAULT_SHOP_MONTHLY_CAP_USD = 15;

/**
 * The cap in micro-USD, overridden for every shop by
 * `DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD` (dollars); an override that is not a
 * plain non-negative number is ignored.
 */
export function shopMonthlyCapMicroUsd(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD?.trim();
  const parsed = raw && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
  const usd = Number.isFinite(parsed) ? parsed : DEFAULT_SHOP_MONTHLY_CAP_USD;
  return Math.round(usd * 1_000_000);
}

/** True when this process must not call Claude (the same switch every provider seam honours). */
export function externalHttpDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1";
}
