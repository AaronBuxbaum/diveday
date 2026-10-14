import { MINUTE_MS, nowMs } from "./clock";
import { log } from "./log";

/** Every inbound webhook route DiveDay answers. The `webhook` field on the line. */
export type WebhookName = "stripe" | "billing" | "ses" | "sms" | "whatsapp" | "email_inbound";

/** One refused-delivery line per webhook and reason, per instance, per minute. */
const REFUSAL_REPORT_INTERVAL_MS = MINUTE_MS;

/**
 * How many distinct `webhook:reason` pairs get a bucket of their own before the
 * rest share one. `reason` is the verifier's own closed vocabulary, but this is
 * the map a flood of junk posts writes into, so it is bounded anyway.
 */
const REFUSAL_KIND_LIMIT = 32;
const REFUSAL_OVERFLOW = "overflow";

/** Module state, so the bound is per instance and dies with the instance. */
const refusals = new Map<string, { lastReportedAt: number; swallowed: number }>();

/**
 * The log line a webhook route writes when it turns a delivery away before
 * reading it: a deployment missing the secret or topic it verifies against,
 * or a signature that does not verify.
 *
 * Both used to be a bare 400 or 503 and nothing else, so a rotated Stripe
 * secret or an SNS topic ARN dropped from the environment refused every
 * payment confirmation and every bounce silently — the provider retries for a
 * while, then gives up, and DiveDay never knew. `infra/lib/observability.ts`
 * counts both lines and alarms on each.
 *
 * **The two are told apart because only one is ours.** `not_configured` is the
 * deployment itself and nobody outside can cause it, so every one is written
 * (`webhook.unconfigured`) and one pages. Everything else — `invalid_signature`,
 * `stale`, `invalid_topic` — is also what any stranger's unsigned `curl` gets,
 * so `webhook.refused` is damped per instance like `reportRefusedQuery` in
 * `src/proxy.ts`: one line per webhook and reason a minute, carrying how many
 * it stands for (`swallowed`), and the alarm counts sustained minutes rather
 * than requests (security review, batch 6).
 *
 * `reason` is the verifier's own status code, never anything from the request
 * body. Never throws: observability failing must not become a 500 on a
 * provider's delivery.
 */
export function logWebhookRefusal(webhook: WebhookName, reason: string, now = nowMs()): void {
  try {
    if (reason === "not_configured") {
      log("webhook.unconfigured", "error", { webhook });
      return;
    }
    const kind = `${webhook}:${reason}`;
    const key = refusals.has(kind) || refusals.size < REFUSAL_KIND_LIMIT ? kind : REFUSAL_OVERFLOW;
    let bucket = refusals.get(key);
    if (!bucket) {
      bucket = { lastReportedAt: Number.NEGATIVE_INFINITY, swallowed: 0 };
      refusals.set(key, bucket);
    }
    bucket.swallowed += 1;
    const sinceLastReport = now - bucket.lastReportedAt;
    // A `now` that moved backwards reports rather than silently suppressing
    // until the clock catches up again.
    if (sinceLastReport >= 0 && sinceLastReport < REFUSAL_REPORT_INTERVAL_MS) return;
    const swallowed = bucket.swallowed;
    bucket.swallowed = 0;
    bucket.lastReportedAt = now;
    log("webhook.refused", "warn", { webhook, reason, swallowed });
  } catch {
    // Never the caller's problem: the refusal itself has already been decided.
  }
}

/** Forget every damping bucket, as a fresh instance would. Tests only. */
export function forgetWebhookRefusalReports(): void {
  refusals.clear();
}
