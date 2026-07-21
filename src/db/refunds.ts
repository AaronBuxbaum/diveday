import { and, eq } from "drizzle-orm";
import { refundOnCancellation } from "@/lib/deposits";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import type { AppDb } from "./client";
import { getBookingPayment, setBookingPayment } from "./payments";
import { bookings, trips } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";

/**
 * The result of attempting an automated refund when a paid seat is cancelled.
 * Only `refunded` moved money; every other outcome leaves the payment row
 * untouched so a "refunded" status never outruns an actual Stripe reversal.
 */
export type CancellationRefundOutcome =
  | { status: "refunded"; amountCents: number }
  /** Inside no window, or past a stated deadline — the seat is non-refundable. */
  | { status: "forfeit" }
  /** The trip states no cancellation window, so automation stays out of it. */
  | { status: "no_policy" }
  /** Nothing was captured (unpaid, waived, or already refunded). */
  | { status: "unpaid" }
  /** Refund is owed but can't be automated here — staff must issue it. */
  | { status: "manual"; reason: "not_stripe" | "not_connected" | "not_refundable" }
  /** Stripe was asked to refund and failed; staff should retry. */
  | { status: "failed" };

export type RefundOnCancellationInput = {
  shopId: string;
  bookingId: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
};

/**
 * Automatically refund a cancelled booking when the shop's stated cancellation
 * window still holds, moving money only through the shop's own connected
 * Stripe account. Deliberately conservative and fail-safe:
 *
 * - Automation is gated on a *stated* window (`no_policy` otherwise) so a shop
 *   that never opted in keeps today's fully staff-run refunds.
 * - Only a Stripe-captured payment can be reversed here; a counter/cash mark
 *   (`provider !== "stripe"`) returns `manual` for staff to handle.
 * - The payment row flips to `refunded` *only* after Stripe confirms the
 *   reversal. A `not_configured`/`failed` provider leaves it paid, so the
 *   feature degrades to the declarative-window bridge it replaces.
 *
 * Tenant-safe: the booking must belong to the shop. Callable outside a route
 * (docs H-07 automated-refund slice).
 */
export async function refundBookingOnCancellation(
  db: AppDb,
  input: RefundOnCancellationInput,
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<CancellationRefundOutcome> {
  const now = input.now ?? new Date();

  const [row] = await db
    .select({ trip: trips })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!row) return { status: "failed" };

  const payment = await getBookingPayment(db, input.shopId, input.bookingId);
  if (!payment || (payment.status !== "paid" && payment.status !== "deposit_paid")) {
    return { status: "unpaid" };
  }

  const decision = refundOnCancellation(row.trip, payment.amountCents ?? 0, now);
  if (decision.outcome === "no_policy") return { status: "no_policy" };
  if (decision.outcome === "forfeit") return { status: "forfeit" };
  if (decision.refundCents <= 0) return { status: "unpaid" };

  if (payment.provider !== "stripe" || !payment.providerRef) {
    return { status: "manual", reason: "not_stripe" };
  }

  const account = await getShopStripeAccount(db, input.shopId);
  if (!canAcceptPayments(account)) return { status: "manual", reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const result = await checkout.refundCheckoutSession(
    stripeAccountId,
    payment.providerRef,
    decision.refundCents,
  );
  if (result.status === "refunded") {
    await setBookingPayment(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: "refunded",
      amountCents: decision.refundCents,
      currency: payment.currency,
      provider: "stripe",
      providerRef: result.refundId ?? payment.providerRef,
      note: "Auto-refunded on cancellation within the free window",
    });
    return { status: "refunded", amountCents: decision.refundCents };
  }
  if (result.status === "not_refundable") return { status: "manual", reason: "not_refundable" };
  if (result.status === "not_configured") return { status: "manual", reason: "not_connected" };
  return { status: "failed" };
}
