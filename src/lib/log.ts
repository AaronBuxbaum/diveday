import { nowDate } from "./clock";
import { recordLogLine } from "./observability/cloudwatch";

export type LogLevel = "info" | "warn" | "error";

/**
 * Structured-log context: ids and codes only. Never a diver/staff name, an email
 * address, a phone number, or medical data — this module has no way to enforce that at
 * compile time, so every call site is on its honor (AGENTS.md hard rule on PII in logs).
 */
export type LogContext = Record<string, string | number | boolean | null | undefined>;

/**
 * Emit one structured JSON line describing an event on the money path (the Stripe and
 * Resend webhooks) or the daily cron — the only observability those paths had before
 * this (docs
 * product/archive/specialist-optimization-audit-20260731.md §7, "Add structured
 * logging to the payment webhook and cron paths"). No new runtime dependency: this
 * writes over `console.error`/`console.warn`/`console.log`, so whatever log drain the
 * deployment already tails (Vercel's, or any other) picks the line up unchanged —
 * there is nothing new to wire up, so no ADR.
 *
 * `event` is a short dotted code (e.g. `"stripe_webhook.event_claimed"`,
 * `"checkout.paid_account_mismatch"`), never a sentence — this lives in `src/lib`, so
 * the same codes-not-sentences rule that keeps English prose out of the domain layer
 * (docs ADR 20260731-domain-layer-copy-leaks) applies to the log line itself.
 * `context` carries ids and enum-like codes only — see {@link LogContext}.
 *
 * Since ADR 20260806-cloudwatch-log-shipping the same line is also buffered for
 * CloudWatch Logs, where it is queryable for a month and where the metric
 * filters in `infra/lib/observability.ts` count the codes worth alarming on.
 * That is strictly additional: the console write above happens first and
 * unconditionally, the buffering step never throws, and a deployment with no
 * CloudWatch credentials behaves exactly as this function always did. Which is
 * also why the event code is part of the contract now — a filter counting
 * `notification.ses_send_failed` stops counting the day that string changes.
 */
export function log(event: string, level: LogLevel, context: LogContext = {}): void {
  const time = nowDate();
  const line = JSON.stringify({ time: time.toISOString(), level, event, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  recordLogLine(line, time.getTime());
}
