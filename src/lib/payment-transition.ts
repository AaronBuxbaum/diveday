import type { PaymentStatus } from "@/db/schema";

/**
 * A payment status only moves forward (`.claude/rules/domain.md`, Payments).
 *
 * This is the one place that says which status a provider reconciliation (a
 * webhook, a replayed or out-of-order event) may write over which. The locked
 * writer, `setBookingPaymentIfNotFinal` in `src/db/payments.ts`, asks here and
 * decides nothing of its own, so the rule can be attacked with generated pairs
 * (`payment-transition.properties.test.ts`) without copying it.
 *
 * Staff writes are not judged here: a refund or a waive is how a final status
 * comes to exist, and `setBookingPayment` trusts its caller.
 */

/**
 * A status a provider-webhook replay must never move a booking backward out
 * of: a human already refunded it, or explicitly waived it, and a duplicate or
 * out-of-order event describing an earlier point in the payment's history must
 * not undo that (CR-004).
 */
export const FINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>([
  "refunded",
  "waived",
]);

export function isFinalPaymentStatus(status: PaymentStatus): boolean {
  return FINAL_PAYMENT_STATUSES.has(status);
}

/** The part of a booking's current payment the rule reads. */
export type CurrentPayment = {
  status: PaymentStatus;
  /** `"stripe"`, `"mixed"`, or null for money taken by hand. */
  provider: string | null;
};

/**
 * Why a reconciliation write is refused:
 *
 * - `final`: the booking is refunded or waived, and the write is neither.
 * - `partly_refunded`: a provider-held payment already gave some money back,
 *   and an earlier "paid" or "deposit paid" event must not put it back.
 */
export type PaymentTransitionRefusal = "final" | "partly_refunded";

/**
 * Why a reconciliation may not write `next` over `current`, or null when it
 * may. A final status is always allowed in: a refund or a waive ends the
 * history from anywhere, and with no payment yet anything may be written.
 */
export function paymentTransitionRefusal(
  current: CurrentPayment | null | undefined,
  next: PaymentStatus,
): PaymentTransitionRefusal | null {
  if (isFinalPaymentStatus(next)) return null;
  if (!current) return null;
  if (isFinalPaymentStatus(current.status)) return "final";
  if (
    current.status === "partly_refunded" &&
    (current.provider === "stripe" || current.provider === "mixed")
  )
    return "partly_refunded";
  return null;
}

/** Whether a reconciliation may write `next` over `current`. */
export function paymentTransitionAllowed(
  current: CurrentPayment | null | undefined,
  next: PaymentStatus,
): boolean {
  return paymentTransitionRefusal(current, next) === null;
}
