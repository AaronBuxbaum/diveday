import Stripe from "stripe";
import { z } from "zod";
import { nowMs } from "../clock";

/**
 * Stripe Connect webhook verification (ADR 20261102-stripe-sdk-adapters).
 * Fails closed: an invalid, stale or early signature, or a missing secret,
 * never reaches event handling.
 */

const stripeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  /** The connected account the event happened on; absent for platform-only events. */
  account: z.string().min(1).optional(),
  /**
   * Stripe's own unix-seconds event-creation time — real Stripe events always
   * carry this. Optional here only so a hand-built fixture that omits it
   * still parses; callers fall back to their own clock (`route.ts` uses
   * `nowDate()`) rather than treating a missing timestamp as an error. This
   * is the only reliable signal for which of two deliveries actually
   * happened later — delivery order is not creation order — and is what lets
   * `stripe_webhook_events` refuse a stale out-of-order `account.updated`.
   */
  created: z.number().optional(),
  /**
   * Whether this event happened against Stripe's live or test mode. Real
   * Stripe events always send this; optional here only so a hand-built
   * fixture that omits it still parses. The webhook route cross-checks it
   * against which of `STRIPE_WEBHOOK_SECRET`/`STRIPE_TEST_WEBHOOK_SECRET`
   * actually verified the signature, so a correctly-signed test-mode event
   * can never mutate live payment state (security review finding, docs
   * product/archive/specialist-optimization-audit-20260731.md §5).
   */
  livemode: z.boolean().optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

export type StripeWebhookEvent = z.infer<typeof stripeEventSchema>;

export type WebhookVerification =
  | { status: "verified"; event: StripeWebhookEvent }
  | { status: "not_configured" }
  | { status: "invalid_signature" }
  | { status: "malformed" };

/** The absolute window, either side of now. Stripe's libraries check only the past side. */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * The one `t=` the header carries, read the way the SDK reads it, or null.
 * More than one is refused: the SDK signs over the last, and a window checked
 * against a different one would be a window over nothing.
 */
function signedTimestamp(header: string): number | null {
  const stamps = header
    .split(",")
    .map((item) => item.split("="))
    .filter(([key]) => key === "t")
    .map(([, value]) => value ?? "");
  if (stamps.length !== 1 || !/^\d{1,12}$/.test(stamps[0] ?? "")) return null;
  return Number.parseInt(stamps[0] ?? "", 10);
}

/**
 * The signature is the SDK's (`Stripe.webhooks.constructEvent`, HMAC over the
 * raw body, constant-time compare). The window is ours: the SDK refuses an
 * event older than its tolerance but accepts one stamped any distance in the
 * future, so a signed event cannot be held and replayed from ahead of time
 * only because this checks both sides itself.
 */
export function verifyStripeWebhook(
  payload: string,
  signatureHeader: string | null,
  secret: string | undefined,
  toleranceSeconds = STRIPE_WEBHOOK_TOLERANCE_SECONDS,
): WebhookVerification {
  if (!secret) return { status: "not_configured" };
  if (!signatureHeader) return { status: "invalid_signature" };
  const timestamp = signedTimestamp(signatureHeader);
  const now = nowMs();
  if (timestamp === null || Math.abs(now / 1000 - timestamp) > toleranceSeconds) {
    return { status: "invalid_signature" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = Stripe.webhooks.constructEvent(
      payload,
      signatureHeader,
      secret,
      toleranceSeconds,
      undefined,
      now,
    );
  } catch (error) {
    return error instanceof Stripe.errors.StripeSignatureVerificationError
      ? { status: "invalid_signature" }
      : { status: "malformed" };
  }
  const event = stripeEventSchema.safeParse(parsedJson);
  if (!event.success) return { status: "malformed" };
  return { status: "verified", event: event.data };
}
