import { periodBounds, type UsageSample } from "@/lib/cost-guardrails";
import type { ProbeEnvironment } from "./probe";

/**
 * Reads one month's Claude spend from DiveDay's own ledger (`claude_usage`),
 * which the usage cron hands in as `readSpendUsd` because `src/lib` makes no
 * database reads (`claudeSpendUsdBetween` in `src/db/assists.ts`).
 *
 * The same honesty rule as every probe in this folder: no `ANTHROPIC_API_KEY`
 * is `not_configured` (nothing can have been spent), a key with no reader
 * wired, or a reader that throws, is `unavailable`, and only a number that came
 * back is `measured`.
 */
export type AnthropicSpendReader = (start: Date, end: Date) => Promise<number>;

export async function readAnthropicSpend({
  env,
  now,
  readSpendUsd,
}: {
  readonly env: ProbeEnvironment;
  readonly now: Date;
  readonly readSpendUsd?: AnthropicSpendReader;
}): Promise<UsageSample> {
  if (!env.ANTHROPIC_API_KEY?.trim()) return { status: "not_configured" };
  if (!readSpendUsd) return { status: "unavailable", reason: "no_reader" };
  const { start, end } = periodBounds("calendar_month", now);
  try {
    return { status: "measured", value: await readSpendUsd(start, end) };
  } catch {
    return { status: "unavailable", reason: "ledger_unreadable" };
  }
}
