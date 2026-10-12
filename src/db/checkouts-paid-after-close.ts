import { and, asc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { CheckoutProvider } from "@/lib/payments/checkout";
import type { AppDb } from "./client";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  STALE_AFTER_MS,
  startPaymentOperation,
} from "./payment-operations";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  paymentOperationIntents,
  people,
  trips,
} from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";
import { checkoutProviderFromEnvironment } from "./stripe-providers";

/**
 * **Money Stripe captured on a session DiveDay had already closed** (issue
 * #2335). `markCheckoutPaidBySessionId` refuses such a completion (the price it
 * quoted no longer describes any seat) and writes `paid_after_close_*` instead
 * of dropping it; this module is the staff side: the queue on the Orders index
 * and the refund it offers. No automatic refund: Aaron's call in the issue's
 * triage, so a human sees the money before it moves back.
 *
 * The money stays owed until `refunded_cents` reaches what was captured, by
 * the refund here or by one made in the Stripe dashboard (`charge.refunded`,
 * `recordStripeChargeRefund`).
 */

/** At most this many rows on the queue; a shop past it has a bigger problem to call about. */
const QUEUE_LIMIT = 50;

export type PaidAfterCloseCheckout = {
  checkoutId: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
  /** Everyone the session was for, in booking order. */
  diverNames: string[];
  /** Still owed back: captured, less what has been refunded. */
  amountCents: number;
  currency: string;
  paidAt: Date;
};

const stillOwed = sql`${bookingCheckouts.refundedCents} < ${bookingCheckouts.paidAfterCloseCents}`;

/** The queue, oldest first, for one shop. */
export async function listPaidAfterCloseCheckouts(
  db: AppDb,
  shopId: string,
): Promise<PaidAfterCloseCheckout[]> {
  const rows = await db
    .select({
      checkoutId: bookingCheckouts.id,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      capturedCents: bookingCheckouts.paidAfterCloseCents,
      refundedCents: bookingCheckouts.refundedCents,
      currency: bookingCheckouts.currency,
      paidAt: bookingCheckouts.paidAfterCloseAt,
    })
    .from(bookingCheckouts)
    // diveday:allow-deleted-trips: money captured for a departure since deleted is still owed back.
    .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookingCheckouts.shopId, shopId),
        isNotNull(bookingCheckouts.paidAfterCloseAt),
        stillOwed,
      ),
    )
    .orderBy(asc(bookingCheckouts.paidAfterCloseAt))
    .limit(QUEUE_LIMIT);
  if (rows.length === 0) return [];

  const names = await db
    .select({
      checkoutId: bookingCheckoutBookings.checkoutId,
      fullName: people.fullName,
    })
    .from(bookingCheckoutBookings)
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
    )
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        inArray(
          bookingCheckoutBookings.checkoutId,
          rows.map((row) => row.checkoutId),
        ),
      ),
    )
    .orderBy(asc(bookings.createdAt), asc(bookings.id));
  const namesByCheckout = new Map<string, string[]>();
  for (const { checkoutId, fullName } of names) {
    namesByCheckout.set(checkoutId, [...(namesByCheckout.get(checkoutId) ?? []), fullName]);
  }

  return rows.map((row) => ({
    checkoutId: row.checkoutId,
    tripId: row.tripId,
    tripTitle: row.tripTitle,
    tripStartsAt: row.tripStartsAt,
    diverNames: namesByCheckout.get(row.checkoutId) ?? [],
    amountCents: (row.capturedCents ?? 0) - row.refundedCents,
    currency: row.currency,
    paidAt: row.paidAt ?? row.tripStartsAt,
  }));
}

/**
 * Why a refund did or did not move money — a code; the page picks the words.
 *
 * - `not_owed` — no such checkout in this shop, or nothing captured on it is
 *   still owed (never paid after closing, or already refunded).
 * - `in_progress` — another refund of it is at Stripe right now.
 * - `needs_reconciliation` — a reversal Stripe confirmed was never recorded
 *   here; a human matches it from the stuck-operations queue first.
 * - `not_connected` — the shop's Stripe account no longer takes payments.
 * - `failed` — Stripe refused, or could not be reached.
 */
export type PaidAfterCloseRefundOutcome =
  | { status: "refunded"; amountCents: number }
  | {
      status: "not_owed" | "in_progress" | "needs_reconciliation" | "not_connected" | "failed";
    };

/**
 * Refund what a closed checkout still owes, through the shop's own connected
 * account. The same shape as every refund in `src/db/refunds.ts`: the decision
 * and the intent (this refund's idempotency key) are made under the checkout's
 * lock and committed **before** the Stripe call; the books move only after
 * Stripe confirms. Touches no seat: nothing was ever marked paid from this
 * session.
 */
export async function refundPaidAfterCloseCheckout(
  db: AppDb,
  shopId: string,
  checkoutId: string,
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
  options: { staleBefore?: Date } = {},
): Promise<PaidAfterCloseRefundOutcome> {
  const staleBefore = options.staleBefore ?? new Date(nowDate().getTime() - STALE_AFTER_MS);
  const claim = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(bookingCheckouts)
      .where(and(eq(bookingCheckouts.id, checkoutId), eq(bookingCheckouts.shopId, shopId)))
      .for("update");
    if (!row || row.paidAfterCloseCents === null) return { status: "not_owed" as const };
    const owedCents = row.paidAfterCloseCents - row.refundedCents;
    if (owedCents <= 0) return { status: "not_owed" as const };

    const refundsOfThisCheckout = and(
      eq(paymentOperationIntents.shopId, shopId),
      eq(paymentOperationIntents.checkoutId, row.id),
      eq(paymentOperationIntents.kind, "refund"),
      eq(paymentOperationIntents.status, "started"),
    );
    const [live] = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(
        and(
          refundsOfThisCheckout,
          gte(paymentOperationIntents.startedAt, staleBefore),
          sql`${paymentOperationIntents.stripeObjectId} is null`,
        ),
      )
      .limit(1);
    if (live) return { status: "in_progress" as const };
    const [unrecorded] = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(and(refundsOfThisCheckout, isNotNull(paymentOperationIntents.stripeObjectId)))
      .limit(1);
    if (unrecorded) return { status: "needs_reconciliation" as const };

    const account = await getShopStripeAccount(tx, shopId);
    if (
      !account ||
      !canAcceptPayments(account) ||
      account.stripeAccountId !== row.stripeAccountId
    ) {
      return { status: "not_connected" as const };
    }
    const intent = await startPaymentOperation(tx, { shopId, kind: "refund", checkoutId: row.id });
    return { status: "claimed" as const, intent, row, owedCents };
  });
  if (claim.status !== "claimed") return { status: claim.status };
  const { intent, row, owedCents } = claim;

  const result = await checkout.refundCheckoutSession(
    row.stripeAccountId,
    row.stripeSessionId,
    idempotencyKeyFor(intent.id),
    owedCents,
  );
  if (result.status !== "refunded") {
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: result.status });
    log("checkout.paid_after_close_refund_failed", "warn", {
      shopId,
      checkoutId: row.id,
      providerStatus: result.status,
    });
    return { status: result.status === "not_configured" ? "not_connected" : "failed" };
  }
  // Durable the moment Stripe confirms it, before the count below (CR-005).
  if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
  await db
    .update(bookingCheckouts)
    .set({ refundedCents: sql`${bookingCheckouts.refundedCents} + ${owedCents}` })
    .where(and(eq(bookingCheckouts.id, row.id), eq(bookingCheckouts.shopId, shopId)));
  await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
  log("checkout.paid_after_close_refunded", "info", { shopId, checkoutId: row.id });
  return { status: "refunded", amountCents: owedCents };
}
