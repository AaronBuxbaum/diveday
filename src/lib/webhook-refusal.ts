import { log } from "./log";

/** Every inbound webhook route DiveDay answers. The `webhook` field on the line. */
export type WebhookName = "stripe" | "billing" | "ses" | "sms" | "whatsapp" | "email_inbound";

/**
 * The one log line a webhook route writes when it turns a delivery away before
 * reading it: a signature that does not verify, or a deployment missing the
 * secret or topic it verifies against.
 *
 * Both used to be a bare 400 or 503 and nothing else, so a rotated Stripe
 * secret or an SNS topic ARN dropped from the environment refused every
 * payment confirmation and every bounce silently — the provider retries for a
 * while, then gives up, and DiveDay never knew. `infra/lib/observability.ts`
 * counts this code (`WebhookRefusals`) and alarms on it.
 *
 * `reason` is the verifier's own status code (`not_configured`,
 * `invalid_signature`, `stale`, …), never anything from the request body.
 */
export function logWebhookRefusal(webhook: WebhookName, reason: string): void {
  log("webhook.refused", "warn", { webhook, reason });
}
