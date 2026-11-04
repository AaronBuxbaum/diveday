import { and, eq, gt, isNotNull, sum } from "drizzle-orm";
import { tipCheckout } from "./checkout-purpose";
import type { AppDb, AppTransaction } from "./client";
import type { BookingCheckout } from "./schema";
import { bookingCheckouts, paymentDisputes, stripeRefundFailures } from "./schema";

/**
 * **A tip's money going back** (issue #3736). A tip is a `booking_checkouts`
 * row with purpose `tip`; Stripe reversing its charge, by a refund or a lost
 * dispute, is written down on the row's `refunded_cents` and nowhere else.
 * The crew split, the crew sheet and the month's tips figure read what is
 * left (`tipNetCents`).
 *
 * This is deliberately not `refunds.ts`: a tip has no seat, no payment row and
 * no booking to unpay, and the fare's refund path must never see one. Money is
 * never moved from here; it writes down what Stripe already did.
 *
 * Every transition takes the tip's row lock first, so two deliveries of the
 * same event, or a refund beside a dispute, are applied one after the other.
 *
 * **Delivery order does not matter** (issue #3835). Stripe promises none, so
 * each path is written to give the same answer in any order:
 *
 * - `refunded_cents` is what came back by a refund (Stripe's running total) plus
 *   what the bank took by a lost dispute, capped at the tip. A refund event
 *   recomputes it from its own total and the lost disputes on file, and a lost
 *   dispute adds to it, so a dispute recorded before a delayed refund event
 *   leaves both counted.
 * - A refund event's running total, taken before a failure, still counts the
 *   refund that failed, so each failure on file stamped after the event is
 *   taken off that total (by the failed refund's own amount, per refund id)
 *   instead of the event being dropped: an earlier refund that did succeed, or
 *   one in the same second as the failure, is still counted. A failure takes
 *   back only what the refund side of `refunded_cents` holds, never a lost
 *   dispute's money; if its refund's event has not arrived the failure takes
 *   back nothing, and that event, once it does, lands net of the failure.
 */

export type TipRefundOutcome =
  | { status: "tip_refunded" | "already_recorded" | "not_found" }
  /** The tip has not settled here yet; Stripe delivers the event again. */
  | { status: "deferred" };

async function lockedTip(tx: AppTransaction, tipId: string): Promise<BookingCheckout | undefined> {
  const [row] = await tx
    .select()
    .from(bookingCheckouts)
    .where(and(eq(bookingCheckouts.id, tipId), tipCheckout()))
    .for("update");
  return row;
}

function capturedOf(tip: BookingCheckout): number {
  return tip.settledTotalCents ?? tip.totalCents;
}

/** What the bank took back by lost disputes, capped at what the tip was. */
async function lostDisputeCents(tx: AppTransaction, tip: BookingCheckout): Promise<number> {
  const [disputes] = await tx
    .select({ lost: sum(paymentDisputes.amountCents) })
    .from(paymentDisputes)
    .where(and(eq(paymentDisputes.checkoutId, tip.id), isNotNull(paymentDisputes.reversedAt)));
  return Math.min(Number(disputes?.lost ?? 0), capturedOf(tip));
}

/**
 * A `charge.refunded` event for a tip. Reconciled to Stripe's cumulative
 * `amount_refunded`, capped at what the tip was and applied only upward, so a
 * replay or an older event adds nothing.
 */
export async function recordTipRefund(
  db: AppDb,
  tip: BookingCheckout,
  amountRefundedCents: number,
  occurredAt: Date,
): Promise<TipRefundOutcome> {
  // The completion has not been handled yet: the refund has nothing to land on.
  if (tip.status === "pending") return { status: "deferred" };
  // Expired here, never paid in: there is nothing to take back out.
  if (tip.status !== "completed") return { status: "not_found" };
  return db.transaction(async (tx): Promise<TipRefundOutcome> => {
    const current = await lockedTip(tx, tip.id);
    if (!current || current.status !== "completed") return { status: "not_found" };
    // A running total older than a failure the tip has since had still counts
    // the refund that failed: take that refund off it, by its own amount.
    const [failures] = await tx
      .select({ failed: sum(stripeRefundFailures.amountCents) })
      .from(stripeRefundFailures)
      .where(
        and(
          eq(stripeRefundFailures.checkoutId, current.id),
          gt(stripeRefundFailures.failedAt, occurredAt),
        ),
      );
    const refundSide = Math.max(0, amountRefundedCents - Number(failures?.failed ?? 0));
    const lost = await lostDisputeCents(tx, current);
    const reversedTotal = Math.min(refundSide + lost, capturedOf(current));
    if (reversedTotal <= current.refundedCents) return { status: "already_recorded" };
    await tx
      .update(bookingCheckouts)
      .set({ refundedCents: reversedTotal })
      .where(and(eq(bookingCheckouts.id, current.id), tipCheckout()));
    return { status: "tip_refunded" };
  });
}

/**
 * A dispute the shop lost: the bank took the money back, so the tip stops
 * counting by that much, capped at what the tip still holds. The caller
 * calls this only for the event that first wrote the reversal, which is what
 * keeps a redelivery from taking it twice. Runs inside the caller's transaction, which
 * already holds the tip's lock ({@link lockedTipFor}).
 */
export async function recordTipLostDispute(
  tx: AppTransaction,
  tip: BookingCheckout,
  disputeAmountCents: number,
): Promise<void> {
  const held = Math.max(0, capturedOf(tip) - tip.refundedCents);
  const taken = Math.min(Math.max(0, disputeAmountCents), held);
  if (taken <= 0) return;
  await tx
    .update(bookingCheckouts)
    .set({ refundedCents: tip.refundedCents + taken })
    .where(and(eq(bookingCheckouts.id, tip.id), tipCheckout()));
}

/** The tip's row, locked, for a transaction that goes on to write a dispute. */
export const lockedTipFor = lockedTip;

export type TipRefundFailureInput = {
  stripeAccountId: string;
  refund: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    failureReason: string | null;
  };
  occurredAt: Date;
};

/**
 * A refund of a tip Stripe accepted and then failed or canceled: the money is
 * the shop's again, so the tip counts again. One `stripe_refund_failures` row
 * per Stripe refund makes a redelivered event a no-op.
 */
export async function reverseTipRefundFailure(
  db: AppDb,
  tip: BookingCheckout,
  input: TipRefundFailureInput,
): Promise<{ status: "reversed" | "already_recorded" | "not_recorded" | "not_found" }> {
  if (tip.status !== "completed") return { status: "not_found" };
  return db.transaction(async (tx) => {
    const current = await lockedTip(tx, tip.id);
    if (!current) return { status: "not_found" as const };
    const [seen] = await tx
      .select({ id: stripeRefundFailures.id })
      .from(stripeRefundFailures)
      .where(eq(stripeRefundFailures.stripeRefundId, input.refund.id))
      .limit(1);
    if (seen) return { status: "already_recorded" as const };
    // Only the refund side can be taken back: a lost dispute's money stays gone.
    const refundSide = Math.max(0, current.refundedCents - (await lostDisputeCents(tx, current)));
    const reversed = Math.min(input.refund.amountCents, refundSide);
    if (reversed > 0) {
      await tx
        .update(bookingCheckouts)
        .set({ refundedCents: current.refundedCents - reversed })
        .where(and(eq(bookingCheckouts.id, current.id), tipCheckout()));
    }
    // Written even when nothing was counted yet (the failure came first): the
    // refund's own event, delivered later, is then recognised as older.
    await tx.insert(stripeRefundFailures).values({
      shopId: current.shopId,
      stripeAccountId: input.stripeAccountId,
      stripeRefundId: input.refund.id,
      checkoutId: current.id,
      bookingId: null,
      // The failed refund's own amount, so a refund event delivered later nets it off.
      amountCents: input.refund.amountCents,
      currency: input.refund.currency || current.currency,
      refundStatus: input.refund.status,
      failureReason: input.refund.failureReason,
      owedUntilRefundedCents: current.refundedCents,
      failedAt: input.occurredAt,
    });
    return { status: reversed > 0 ? ("reversed" as const) : ("not_recorded" as const) };
  });
}
