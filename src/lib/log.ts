import { nowDate } from "./clock";

export type LogLevel = "info" | "warn" | "error";

/** What {@link log} hands each finished line to after writing it to the console. */
type LogSink = (line: string, timestamp: number) => void;

/**
 * Where a written line goes *in addition to* the console. Nothing, until a
 * server instance installs one.
 *
 * This used to be a static `import { recordLogLine } from
 * "./observability/cloudwatch"`, and that import was a browser seam of the kind
 * PR #1347 spent itself closing. The path is three hops and none of them looks
 * like logging: `src/i18n/on-error.ts` — the ICU error handler every translator
 * is built with, and therefore reachable from every Client Component that reads
 * copy — imports `log`, which imported the shipper, which reaches
 * `@aws-sdk/client-cloudwatch-logs`. Turbopack browserified it: **316.6 KB raw
 * / 93.7 KB gzip across two emitted chunks**, measured off `.next/static`.
 *
 * Being behind `await import()` in the shipper made it lazy, not absent — so it
 * never entered a first-load bundle and `pnpm perf:budget`, which measures the
 * intersection of first-load chunks, could not see it. The offline-manifest
 * service worker could: it caches the built shell, on the one surface in this
 * app designed for a divemaster on marina Wi-Fi.
 *
 * Inverting it is not a workaround for the bundler. The browser has no
 * CloudWatch credentials and never had any, so `recordLogLine` there was always
 * dead code that returned on its first config read — this makes the module
 * graph say what was already true at runtime.
 *
 * Installed from `src/instrumentation.ts`, beside `setFlushDeferrer`, for the
 * reason written there: `src/lib` is framework-free by rule, and that file is
 * the one place that already runs exactly once per server instance, Node
 * runtime only.
 */
let sink: LogSink | null = null;

/** Install the process-wide sink. Server-side only; see {@link sink}. */
export function setLogSink(next: LogSink | null): void {
  sink = next;
}

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
  sink?.(line, time.getTime());
}
