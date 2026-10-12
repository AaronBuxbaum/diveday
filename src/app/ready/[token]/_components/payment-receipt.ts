import { getLatestCheckoutForBooking, refreshCheckoutFromStripe } from "@/db/checkouts";
import type { getDb } from "@/db/client";
import { getBookingPayment } from "@/db/payments";
import type { ShopCurrency } from "@/lib/money";

/**
 * What this booking has actually been charged, or null when nothing has
 * settled. **Only the settled case**, on purpose: the unpaid states — an open
 * Stripe session, a payable balance — are the payment checklist row's job on
 * this page, and a second "Pay now" card beside it would be the duplication
 * this page was collapsed to remove (ADR 20260820-one-page-after-booking). The
 * receipt is the one thing the checklist genuinely cannot say: *how much*.
 *
 * The pending-checkout refresh comes with it, but **only on a return from
 * Stripe**. A diver who has just paid routinely beats the webhook home, and
 * without asking Stripe directly they would read "payment due" on the page
 * they were sent to by paying. On every *other* visit the webhook has long
 * since landed — and unlike the confirmation this replaced, which a diver saw
 * once, this page is opened from every reminder for as long as the trip is
 * ahead. Refreshing unconditionally would turn each of those into an outbound
 * Stripe call for an abandoned session that is never going to change.
 */
export async function resolvePaymentReceipt(
  // i18n-exempt: multi-line type annotation, not copy — the scanner misreads the signature as a string.
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  bookingId: string,
  /** This request is Stripe's own return, so an open session is worth asking about. */
  returnedFromCheckout: boolean,
  /**
   * The full per-diver fare, for the balance still owed after a deposit. Null
   * on an unpriced departure, which then quotes no balance rather than
   * guessing one.
   */
  fullPriceCents: number | null,
  /**
   * What to show when a settled payment predates the currency column and has
   * none of its own. A settled amount that *does* carry a currency keeps it —
   * it is evidence of what was charged, and today's shop setting must never
   * reinterpret it.
   */
  shopCurrency: ShopCurrency,
): Promise<PaymentReceipt> {
  const receipt = (settled: Awaited<ReturnType<typeof getBookingPayment>>): PaymentReceipt => {
    if (settled?.status !== "paid" && settled?.status !== "deposit_paid") return null;
    const isDeposit = settled.status === "deposit_paid";
    return {
      amountCents: settled.amountCents ?? null,
      currency: settled.currency ?? shopCurrency,
      isDeposit,
      balanceDueCents:
        isDeposit && fullPriceCents !== null
          ? Math.max(0, fullPriceCents - (settled.amountCents ?? 0))
          : 0,
    };
  };

  const settled = await getBookingPayment(db, shopId, bookingId);
  if (settled?.status === "paid" || settled?.status === "deposit_paid") return receipt(settled);
  if (settled?.status === "waived" || !returnedFromCheckout) return null;

  const checkout = await getLatestCheckoutForBooking(db, shopId, bookingId);
  if (checkout?.status !== "pending") return null;
  // The diver may have just paid and beaten the webhook home; ask Stripe.
  const refreshed = await refreshCheckoutFromStripe(db, shopId, checkout.id);
  return refreshed?.status === "completed"
    ? receipt(await getBookingPayment(db, shopId, bookingId))
    : null;
}

/** A settled charge, as this page states it back. Null when nothing has settled. */
export type PaymentReceipt = {
  amountCents: number | null;
  currency: string;
  /** True when only a deposit has been paid; a balance is still owed. */
  isDeposit: boolean;
  /** The per-diver balance still due after a deposit, or 0 when paid in full. */
  balanceDueCents: number;
} | null;
