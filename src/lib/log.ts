import { nowDate } from "./clock";

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
 */
export function log(event: string, level: LogLevel, context: LogContext = {}): void {
  const line = JSON.stringify({ time: nowDate().toISOString(), level, event, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
