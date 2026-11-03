import { and, desc, eq, inArray } from "drizzle-orm";
import { log } from "@/lib/log";
import { isCapturedPaymentStatus } from "@/lib/payment-source";
import type { PaymentSourceLookup } from "@/lib/payments/payment-sources";
import { lockSeatsInOrder } from "./checkouts";
import type { AppDb, AppTransaction } from "./client";
import { setBookingPayment } from "./payments";
import type { BookingCheckout, Order } from "./schema";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPaymentEvents,
  bookingPayments,
  orders,
  stripeRefundFailures,
} from "./schema";
import { findStripePaymentTarget } from "./stripe-payment-targets";

/**
 * **A refund Stripe accepted and later reported failed or canceled** (issue
 * #2291, `charge.refund.updated`). The card was closed, the bank returned it:
 * the money is back in the shop's Stripe balance, and the books that said it
 * went back are wrong until this runs.
 *
 * What it does, in one transaction per event:
 *
 * - writes one `stripe_refund_failures` row per Stripe refund — the unique
 *   refund id is what makes a redelivery a no-op;
 * - lowers the order's or checkout's `refunded_cents` by the failed amount, so
 *   Stripe's cumulative `amount_refunded` on the next `charge.refunded` lines
 *   up again and a new refund is recorded rather than read as already counted;
 * - an order gets its money back (`amount_paid_cents`, status, its seat's
 *   payment row); a checkout seat DiveDay refunded itself goes back to the
 *   state the trail recorded before that refund. A refund made in the Stripe
 *   dashboard names no seat, so no seat is guessed at;
 * - money captured after its checkout closed (`paid_after_close_*`) goes back
 *   on that queue, which already says it is owed.
 *
 * Nothing is re-issued: the diver shows as owed on the Orders index
 * (the failed-refund read in `src/db/unfinished.ts`) until a new refund, from DiveDay or the dashboard,
 * brings `refunded_cents` back to where it stood.
 *
 * Not told to the accounting integrations: an `order.refunded` they received
 * stays booked there (a follow-up, out of #2291's scope).
 */

export type RefundFailureInput = {
  /** The event's own `account`. */
  stripeAccountId: string;
  paymentIntentId: string;
  refund: {
    id: string;
    amountCents: number;
    currency: string;
    /** Stripe's refund status; only `failed` and `canceled` reverse anything. */
    status: string;
    failureReason: string | null;
  };
  occurredAt: Date;
};

export type RefundFailureOutcome = {
  status:
    | "reversed"
    | "already_recorded"
    /** Not `failed` or `canceled`: a pending or succeeded refund changes nothing here. */
    | "not_failed"
    /** A charge DiveDay never raised, or another account's. */
    | "not_found"
    /** DiveDay never counted this money as refunded, so there is nothing to reverse. */
    | "not_recorded";
};

const REVERSING_STATUSES = new Set(["failed", "canceled"]);

export async function recordStripeRefundFailure(
  db: AppDb,
  input: RefundFailureInput,
  lookup?: PaymentSourceLookup,
): Promise<RefundFailureOutcome> {
  if (!REVERSING_STATUSES.has(input.refund.status)) return { status: "not_failed" };
  if (!Number.isInteger(input.refund.amountCents) || input.refund.amountCents <= 0) {
    return { status: "not_recorded" };
  }
  const target = await findStripePaymentTarget(
    db,
    { stripeAccountId: input.stripeAccountId, paymentIntentId: input.paymentIntentId },
    lookup,
  );
  if (target.kind === "none") return { status: "not_found" };
  const outcome =
    target.kind === "order"
      ? await reverseOnOrder(db, target.order, input)
      : await reverseOnCheckout(db, target.checkout, input);
  log("stripe_refund.failed_reversed", outcome.status === "reversed" ? "warn" : "info", {
    stripeAccountId: input.stripeAccountId,
    target: target.kind,
    outcome: outcome.status,
  });
  return outcome;
}

async function alreadyRecorded(tx: AppTransaction, refundId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: stripeRefundFailures.id })
    .from(stripeRefundFailures)
    .where(eq(stripeRefundFailures.stripeRefundId, refundId))
    .limit(1);
  return row !== undefined;
}

function scaled(value: number, numerator: number, denominator: number): number {
  if (denominator <= 0) return value;
  return Math.max(0, Math.round((value * numerator) / denominator));
}

async function reverseOnOrder(
  db: AppDb,
  order: Order,
  input: RefundFailureInput,
): Promise<RefundFailureOutcome> {
  return db.transaction(async (tx): Promise<RefundFailureOutcome> => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if (!current) return { status: "not_found" };
    if (await alreadyRecorded(tx, input.refund.id)) return { status: "already_recorded" };
    if (current.status !== "refunded" && current.status !== "partly_refunded") {
      return { status: "not_recorded" };
    }
    const reversed = Math.min(input.refund.amountCents, current.refundedCents);
    if (reversed <= 0) return { status: "not_recorded" };

    const refundedCents = current.refundedCents - reversed;
    const amountPaidCents = current.amountPaidCents + reversed;
    const status = refundedCents > 0 ? "partly_refunded" : "paid";
    // A refund prorated tax and the pass-through fee down with the money; the
    // money coming back brings them back in the same proportion. An order
    // refunded to zero kept neither figure, so there is nothing to scale from.
    const restorable = current.amountPaidCents > 0;
    if (!restorable) {
      log("order.refund_failed_proration_unrecoverable", "warn", {
        shopId: current.shopId,
        orderId: current.id,
      });
    }
    await tx
      .update(orders)
      .set({
        status,
        amountPaidCents,
        refundedCents,
        taxCents: restorable
          ? scaled(current.taxCents, amountPaidCents, current.amountPaidCents)
          : current.taxCents,
        passThroughCents: restorable
          ? scaled(current.passThroughCents, amountPaidCents, current.amountPaidCents)
          : current.passThroughCents,
        refundedAt: refundedCents > 0 ? current.refundedAt : null,
        updatedAt: input.occurredAt,
      })
      .where(eq(orders.id, current.id));
    if (current.bookingId) {
      await setBookingPayment(tx, {
        shopId: current.shopId,
        bookingId: current.bookingId,
        status,
        amountCents: status === "paid" ? current.totalCents : amountPaidCents,
        currency: current.currency,
        provider: "stripe",
        providerRef: current.stripeInvoiceId,
        operation: "refund_failed",
      });
    }
    await tx.insert(stripeRefundFailures).values({
      shopId: current.shopId,
      stripeAccountId: input.stripeAccountId,
      stripeRefundId: input.refund.id,
      orderId: current.id,
      bookingId: current.bookingId,
      amountCents: reversed,
      currency: input.refund.currency || current.currency,
      refundStatus: input.refund.status,
      failureReason: input.refund.failureReason,
      owedUntilRefundedCents: current.refundedCents,
      failedAt: input.occurredAt,
    });
    return { status: "reversed" };
  });
}

/**
 * The seat a DiveDay refund of this checkout wrote, back to the state the
 * trail recorded just before it. DiveDay's own seat refunds name the refund
 * as the payment row's `provider_ref`; a seat written since (anything else
 * there now) is left alone.
 */
async function restoreRefundedSeat(
  tx: AppTransaction,
  checkout: BookingCheckout,
  coveredIds: string[],
  refundId: string,
): Promise<string | null> {
  if (coveredIds.length === 0) return null;
  const [seat] = await tx
    .select()
    .from(bookingPayments)
    .where(
      and(
        eq(bookingPayments.shopId, checkout.shopId),
        inArray(bookingPayments.bookingId, coveredIds),
        eq(bookingPayments.providerRef, refundId),
      ),
    )
    .limit(1);
  if (!seat) return null;
  const trail = await tx
    .select()
    .from(bookingPaymentEvents)
    .where(
      and(
        eq(bookingPaymentEvents.shopId, checkout.shopId),
        eq(bookingPaymentEvents.bookingId, seat.bookingId),
      ),
    )
    .orderBy(desc(bookingPaymentEvents.occurredAt), desc(bookingPaymentEvents.seq))
    .limit(50);
  const refundAt = trail.findIndex((event) => event.providerRef === refundId);
  const before = refundAt === -1 ? undefined : trail[refundAt + 1];
  if (!before || !isCapturedPaymentStatus(before.status)) return null;
  await setBookingPayment(tx, {
    shopId: checkout.shopId,
    bookingId: seat.bookingId,
    status: before.status,
    amountCents: before.amountCents,
    currency: before.currency,
    provider: before.provider,
    providerRef: before.providerRef,
    operation: "refund_failed",
  });
  return seat.bookingId;
}

async function reverseOnCheckout(
  db: AppDb,
  checkout: BookingCheckout,
  input: RefundFailureInput,
): Promise<RefundFailureOutcome> {
  // Only a fare is refunded through DiveDay; a tip's reversal is recorded
  // nowhere yet (ADR 20260726-post-trip-tipping, issue #2718).
  if (checkout.purpose !== "fare") return { status: "not_found" };
  const paidAfterClose = checkout.status === "expired" && checkout.paidAfterCloseCents !== null;
  if (checkout.status !== "completed" && !paidAfterClose) return { status: "not_found" };
  const covered = await db
    .select({ bookingId: bookingCheckoutBookings.bookingId })
    .from(bookingCheckoutBookings)
    // diveday:any-checkout-purpose: the fare this reversal was checked against above
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, checkout.shopId),
        eq(bookingCheckoutBookings.checkoutId, checkout.id),
      ),
    );
  const coveredIds = covered.map((row) => row.bookingId);
  return db.transaction(async (tx): Promise<RefundFailureOutcome> => {
    // Seats, then the checkout: the one order for this pair (issue #2335).
    await lockSeatsInOrder(tx, coveredIds);
    const [current] = await tx
      .select()
      .from(bookingCheckouts)
      // diveday:any-checkout-purpose: the fare this reversal was checked against above
      .where(eq(bookingCheckouts.id, checkout.id))
      .for("update");
    if (!current) return { status: "not_found" };
    if (await alreadyRecorded(tx, input.refund.id)) return { status: "already_recorded" };
    const reversed = Math.min(input.refund.amountCents, current.refundedCents);
    if (reversed <= 0) return { status: "not_recorded" };

    await tx
      .update(bookingCheckouts)
      // diveday:any-checkout-purpose: the fare this reversal was checked against above
      .set({ refundedCents: current.refundedCents - reversed })
      .where(eq(bookingCheckouts.id, current.id));
    const bookingId = paidAfterClose
      ? null
      : await restoreRefundedSeat(tx, current, coveredIds, input.refund.id);
    await tx.insert(stripeRefundFailures).values({
      shopId: current.shopId,
      stripeAccountId: input.stripeAccountId,
      stripeRefundId: input.refund.id,
      checkoutId: current.id,
      bookingId,
      amountCents: reversed,
      currency: input.refund.currency || current.currency,
      refundStatus: input.refund.status,
      failureReason: input.refund.failureReason,
      owedUntilRefundedCents: current.refundedCents,
      failedAt: input.occurredAt,
    });
    return { status: "reversed" };
  });
}
