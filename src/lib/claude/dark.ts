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
 * - `over_cap`: the shop's spend this UTC calendar month reached its cap. A
 *   demo tenant's cap is the small demo one (`DEFAULT_DEMO_SHOP_MONTHLY_CAP_USD`).
 * - `demo_over_cap`: a demo tenant, and every demo together spent the demo
 *   allowance this month. Anyone can mint a demo from the public demo door,
 *   so a per-shop cap alone would be no cap at all: each visitor would get a
 *   fresh allowance of somebody else's money. Demos were dark outright until
 *   Aaron lit them under this shared allowance (2026-10-23).
 */
export const ASSIST_DARK_REASONS = [
  "no_key",
  "external_http_disabled",
  "shop_off",
  "over_cap",
  "demo_over_cap",
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
  /** The shop's own cap: the demo one for a demo tenant. */
  readonly capMicroUsd: number;
  /** Every demo tenant's spend this calendar month; read only for a demo. */
  readonly demoSpentMicroUsd?: number;
  readonly demoCapMicroUsd?: number;
};

/** Why the assist is dark, or null when it may run. */
export function assistDarkReason(conditions: AssistConditions): AssistDarkReason | null {
  if (!conditions.hasKey) return "no_key";
  if (conditions.externalHttpDisabled) return "external_http_disabled";
  if (!conditions.shopEnabled) return "shop_off";
  // A spend we could not read is not a spend of zero: each cap fails closed.
  if (spentOrOver(conditions.spentMicroUsd, conditions.capMicroUsd)) return "over_cap";
  if (
    conditions.shopIsDemo &&
    spentOrOver(conditions.demoSpentMicroUsd ?? Number.NaN, conditions.demoCapMicroUsd ?? 0)
  ) {
    return "demo_over_cap";
  }
  return null;
}

function spentOrOver(spent: number, cap: number): boolean {
  return !Number.isFinite(spent) || spent < 0 || spent >= cap;
}

/**
 * The per-shop monthly cap, in USD. At the volumes in the build plan a busy
 * shop spends a few dollars a month; $15 leaves room for a month of heavy
 * onboarding and stops a loop long before it is a bill anyone notices.
 */
export const DEFAULT_SHOP_MONTHLY_CAP_USD = 15;

/**
 * A demo tenant's own monthly cap, in USD: enough for a visitor to try a few
 * drafts and a card scan, small enough that one visitor cannot empty the
 * allowance every demo shares.
 */
export const DEFAULT_DEMO_SHOP_MONTHLY_CAP_USD = 1;

/** What every demo tenant together may spend in a month, in USD. */
export const DEFAULT_DEMO_MONTHLY_CAP_USD = 10;

function capFromEnv(raw: string | undefined, fallbackUsd: number): number {
  const trimmed = raw?.trim();
  const parsed = trimmed && /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return Math.round((Number.isFinite(parsed) ? parsed : fallbackUsd) * 1_000_000);
}

/** A demo tenant's own cap in micro-USD, overridden by `DIVEDAY_CLAUDE_DEMO_SHOP_MONTHLY_CAP_USD`. */
export function demoShopMonthlyCapMicroUsd(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return capFromEnv(
    env.DIVEDAY_CLAUDE_DEMO_SHOP_MONTHLY_CAP_USD,
    DEFAULT_DEMO_SHOP_MONTHLY_CAP_USD,
  );
}

/** Every demo's shared cap in micro-USD, overridden by `DIVEDAY_CLAUDE_DEMO_MONTHLY_CAP_USD`. */
export function demoMonthlyCapMicroUsd(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return capFromEnv(env.DIVEDAY_CLAUDE_DEMO_MONTHLY_CAP_USD, DEFAULT_DEMO_MONTHLY_CAP_USD);
}

/**
 * The cap in micro-USD, overridden for every shop by
 * `DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD` (dollars); an override that is not a
 * plain non-negative number is ignored.
 */
export function shopMonthlyCapMicroUsd(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  return capFromEnv(env.DIVEDAY_CLAUDE_SHOP_MONTHLY_CAP_USD, DEFAULT_SHOP_MONTHLY_CAP_USD);
}

/** True when this process must not call Claude (the same switch every provider seam honours). */
export function externalHttpDisabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1";
}
