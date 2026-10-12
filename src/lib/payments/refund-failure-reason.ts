/**
 * **Why Stripe says a refund failed, narrowed to Stripe's own words.**
 *
 * `stripe_refund_failures.failure_reason` is kept on a row the erasure leaves
 * standing on the promise that it holds no free text (`ERASURE_KEEPS`,
 * `src/db/erasure-coverage.test.ts`). The webhook body is not ours, so the
 * column only ever takes one of the codes Stripe documents for
 * `Refund.failure_reason`; anything else is stored as `unknown`, which is
 * itself one of Stripe's codes.
 */
export const REFUND_FAILURE_REASONS = [
  "charge_for_pending_refund_disputed",
  "declined",
  "expired_or_canceled_card",
  "insufficient_funds",
  "lost_or_stolen_card",
  "merchant_request",
  "unknown",
] as const;

export type RefundFailureReason = (typeof REFUND_FAILURE_REASONS)[number];

const KNOWN: ReadonlySet<string> = new Set(REFUND_FAILURE_REASONS);

/** `null` when Stripe gives no reason; a documented code, or `unknown`, otherwise. */
export function refundFailureReasonOf(raw: unknown): RefundFailureReason | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && KNOWN.has(raw)) return raw as RefundFailureReason;
  return "unknown";
}
