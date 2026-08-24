export type PaymentStatusValue =
  | "unpaid"
  | "deposit_paid"
  | "paid"
  | "partly_refunded"
  | "waived"
  | "refunded";

/**
 * Payment states in which the shop has actually **taken money** for a seat and
 * could therefore be asked to give some back.
 *
 * Deliberately not `PAYMENT_CLEARED` (`src/lib/readiness.ts`), which answers a
 * different question: that set carries `waived` because a comped diver may
 * board, and a comped diver is owed nothing. Every refund path wants *this*
 * one — "is there money here to return" — which is why `ready.ts` has always
 * kept its `captured` separate from its `settled`.
 *
 * It exists as one exported set rather than four hand-written disjunctions
 * because that is exactly how `partly_refunded` came to be missed: the status
 * was added to the boarding gate, to the revenue sums and to the roster line
 * above, and four `status !== "paid" && status !== "deposit_paid"` predicates
 * across two files went on quietly answering "unpaid" for a seat holding real
 * money — which on a shop-cancelled trip told the diver they were never
 * charged and returned nothing (issue #699 security review). A new returnable
 * state now lands in one place.
 */
const CAPTURED_PAYMENT_STATUSES = [
  "deposit_paid",
  "paid",
  "partly_refunded",
] as const satisfies readonly PaymentStatusValue[];

/** See {@link CAPTURED_PAYMENT_STATUSES} — the array form, for `inArray`. */
export const capturedPaymentStatuses: readonly PaymentStatusValue[] = CAPTURED_PAYMENT_STATUSES;

export type PaymentSourceCode = "online" | "package" | "counter" | "waived";

/** True when the shop holds money on this seat that a refund could return. */
export function isCapturedPaymentStatus(
  status: PaymentStatusValue | null | undefined,
): status is (typeof CAPTURED_PAYMENT_STATUSES)[number] {
  return status != null && (CAPTURED_PAYMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * How a settled payment was taken, for the roster line. Since checkout-at-booking
 * shipped, a booking can be paid online through Stripe or marked paid by staff at
 * the counter, and the manual payment select sits right next to that state — so a
 * green "Paid" is ambiguous without saying which. Only settled states carry a
 * source code; the roster localizes that code into the staff member's locale.
 * Unpaid and refunded return null because their status label already tells the
 * whole story. `partly_refunded` counts as settled: the shop is
 * still holding money on that seat, and how it was taken is exactly what a
 * staffer deciding whether to send the rest back needs to know (issue #699).
 */
export function paymentSourceLine(
  status: PaymentStatusValue | null | undefined,
  provider: string | null | undefined,
): PaymentSourceCode | null {
  if (isCapturedPaymentStatus(status)) {
    if (provider === "stripe") return "online";
    if (provider === "dive_package") return "package";
    return "counter";
  }
  if (status === "waived") return "waived";
  return null;
}
