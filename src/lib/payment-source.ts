export type PaymentStatusValue =
  | "unpaid"
  | "deposit_paid"
  | "paid"
  | "partly_refunded"
  | "waived"
  | "refunded";

/**
 * How a settled payment was taken, for the roster line. Since checkout-at-booking
 * shipped, a booking can be paid online through Stripe or marked paid by staff at
 * the counter, and the manual payment select sits right next to that state — so a
 * green "Paid" is ambiguous without saying which. Only settled states carry a
 * source; unpaid and refunded return null because their status label already
 * tells the whole story. `partly_refunded` counts as settled: the shop is
 * still holding money on that seat, and how it was taken is exactly what a
 * staffer deciding whether to send the rest back needs to know (issue #699).
 */
export function paymentSourceLine(
  status: PaymentStatusValue | null | undefined,
  provider: string | null | undefined,
): string | null {
  if (status === "paid" || status === "deposit_paid" || status === "partly_refunded") {
    return provider === "stripe" ? "Paid online · Stripe" : "Marked paid at the counter";
  }
  if (status === "waived") return "Waived — no charge";
  return null;
}
