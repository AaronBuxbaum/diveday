import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { refundOnCancellation } from "@/lib/deposits";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import type { AppDb } from "./client";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { getBookingPayment, setBookingPayment } from "./payments";
import { bookingPayments, bookings, people, trips } from "./schema";
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
  const now = input.now ?? nowDate();

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

  // A refund is owed. Only a Stripe-captured payment can be auto-reversed here;
  // a counter/cash mark (provider not "stripe", commonly with no recorded
  // amount) is owed a refund too but staff must issue it — never silently drop
  // it as "unpaid" just because the amount wasn't recorded.
  if (payment.provider !== "stripe" || !payment.providerRef) {
    return { status: "manual", reason: "not_stripe" };
  }
  if (decision.refundCents <= 0) {
    // A Stripe payment with no recorded amount shouldn't happen; don't fire a
    // zero/blank refund — hand it to staff to reconcile.
    return { status: "manual", reason: "not_refundable" };
  }

  const account = await getShopStripeAccount(db, input.shopId);
  if (!canAcceptPayments(account)) return { status: "manual", reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  // Durable evidence before calling Stripe (CR-005), and the source of this
  // refund's Idempotency-Key: each cancellation mints its own intent row with
  // a fresh id, so a retry of *this* attempt converges on the one Stripe
  // refund it already issued, while a second party member cancelling for the
  // same amount off the same payment intent is a second, distinct refund
  // rather than a replay of the first (PAY-C1). Same shape as `refundOrder`.
  const intent = await startPaymentOperation(db, {
    shopId: input.shopId,
    kind: "refund",
    bookingId: input.bookingId,
  });

  const result = await checkout.refundCheckoutSession(
    stripeAccountId,
    payment.providerRef,
    idempotencyKeyFor(intent.id),
    decision.refundCents,
  );
  if (result.status === "refunded") {
    // Durable the moment Stripe confirms the refund exists — before the
    // local payment-row update below that could still fail (CR-005).
    if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
    await setBookingPayment(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: "refunded",
      amountCents: decision.refundCents,
      currency: payment.currency,
      provider: "stripe",
      providerRef: result.refundId ?? payment.providerRef,
      note: "Auto-refunded on cancellation within the free window",
      // The capture this reverses is overwritten in `booking_payments`; the
      // append-only trail is where it survives (ADR
      // 20260803-booking-payment-events).
      operation: "cancellation_refund",
    });
    await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
    return { status: "refunded", amountCents: decision.refundCents };
  }
  await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: result.status });
  if (result.status === "not_refundable") return { status: "manual", reason: "not_refundable" };
  if (result.status === "not_configured") return { status: "manual", reason: "not_connected" };
  return { status: "failed" };
}

/**
 * What happened to one seat's money when the *shop* cancelled the departure.
 *
 * There is no `forfeit` and no `no_policy` here, and that absence is the whole
 * decision: a cancellation window is a rule about a diver changing their mind,
 * and it has no bearing on a trip the shop took away
 * (ADR 20260813-shop-cancellation-refunds-itself).
 */
export type ShopCancellationRefundOutcome =
  | { status: "refunded"; amountCents: number }
  /**
   * This seat's capture was already reversed — by an earlier pass of the same
   * cascade or sweep, or by staff. Distinct from `unpaid` because the diver's
   * message depends on it: a resumed cascade that read this as "nothing was
   * captured" would tell someone who paid and was refunded that they were never
   * charged.
   */
  | { status: "already_refunded" }
  /** Nothing was captured (unpaid or waived). */
  | { status: "unpaid" }
  /** Money is owed but no card can be reversed from here — staff must return it. */
  | { status: "manual"; reason: "not_stripe" | "not_connected" | "not_refundable" }
  /** Stripe was asked to refund and failed; staff should retry. */
  | { status: "failed" };

/**
 * Refund a booking because the shop cancelled its departure — a weather
 * blow-out or the minimum-head-count sweep.
 *
 * The same Stripe path and the same connected-account rule as
 * `refundBookingOnCancellation`, with the window/forfeit arithmetic removed
 * rather than reused. The diver did nothing; the full capture goes back.
 *
 * **Idempotent through the payment row.** A refunded booking reads back as
 * `unpaid` here, so a resumed blow-out cascade or a re-run sweep never issues a
 * second reversal — which matters, because both callers are retry loops.
 *
 * Degrades exactly like its sibling: a counter/cash mark or a disconnected
 * account returns `manual` and lands on the staff queue, because there is no
 * card to reverse. What must never happen is silence — every caller states the
 * outcome in the mail the diver gets.
 *
 * Tenant-safe: the booking must belong to the shop.
 */
export async function refundBookingOnShopCancellation(
  db: AppDb,
  input: { shopId: string; bookingId: string },
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<ShopCancellationRefundOutcome> {
  // The booking must be this shop's. `getBookingPayment` is tenant-scoped too,
  // so a foreign caller could move no money regardless — this states the rule
  // rather than relying on a second function to happen to enforce it, and it
  // answers `failed` instead of the misleading `unpaid`.
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return { status: "failed" };

  const payment = await getBookingPayment(db, input.shopId, input.bookingId);
  if (payment?.status === "refunded") return { status: "already_refunded" };
  if (!payment || (payment.status !== "paid" && payment.status !== "deposit_paid")) {
    return { status: "unpaid" };
  }

  // A refund is owed unconditionally. Only a Stripe capture can be reversed
  // from here; a counter/cash mark is owed one too, and staff issue it.
  if (payment.provider !== "stripe" || !payment.providerRef) {
    return { status: "manual", reason: "not_stripe" };
  }
  const refundCents = payment.amountCents ?? 0;
  if (refundCents <= 0) {
    // A Stripe payment with no recorded amount shouldn't happen; don't fire a
    // zero/blank refund — hand it to staff to reconcile.
    return { status: "manual", reason: "not_refundable" };
  }

  const account = await getShopStripeAccount(db, input.shopId);
  if (!canAcceptPayments(account)) return { status: "manual", reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  // Durable evidence before calling Stripe, and the source of this refund's
  // Idempotency-Key (CR-005) — same shape as the diver-cancel arm above.
  const intent = await startPaymentOperation(db, {
    shopId: input.shopId,
    kind: "refund",
    bookingId: input.bookingId,
  });

  const result = await checkout.refundCheckoutSession(
    stripeAccountId,
    payment.providerRef,
    idempotencyKeyFor(intent.id),
    refundCents,
  );
  if (result.status === "refunded") {
    if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
    await setBookingPayment(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: "refunded",
      amountCents: refundCents,
      currency: payment.currency,
      provider: "stripe",
      providerRef: result.refundId ?? payment.providerRef,
      note: "Auto-refunded: the shop cancelled this departure",
      operation: "shop_cancellation_refund",
    });
    await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
    return { status: "refunded", amountCents: refundCents };
  }
  await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: result.status });
  if (result.status === "not_refundable") return { status: "manual", reason: "not_refundable" };
  if (result.status === "not_configured") return { status: "manual", reason: "not_connected" };
  return { status: "failed" };
}

/**
 * The money story a diver is told when the shop cancels, as a code — the
 * template picks the words (ADR 20260731-domain-layer-copy-leaks).
 *
 * `refund_owed` covers every way the reversal did not happen here: a counter
 * payment, a disconnected account, a Stripe refusal, a failure. The diver reads
 * the same honest sentence in all four cases — the shop owes them money and
 * will be in touch — because the difference between them is the shop's problem
 * to solve, not the diver's to understand.
 */
export function shopCancellationPaymentStory(
  outcome: ShopCancellationRefundOutcome,
): "none" | "refunded" | "refund_owed" {
  if (outcome.status === "unpaid") return "none";
  // `already_refunded` reads the same to the diver as a reversal this pass made
  // — the money is on its way back either way, and a resumed cascade must not
  // tell somebody who paid that they were never charged.
  if (outcome.status === "refunded" || outcome.status === "already_refunded") return "refunded";
  return "refund_owed";
}

/**
 * The money half of a shop-cancelled departure: refund every seat still active
 * on it, and report what happened to each so the caller's mail can say so.
 *
 * Reads the bookings itself rather than taking the notification recipient list,
 * because those two sets are not the same — a walk-in with no email address, or
 * a diver whose person row was erased, is unreachable but has just as much money
 * with the shop. Money comes back whether or not anyone can be told.
 */
/**
 * How long a captured payment must have been sitting before an owed refund is
 * loud enough for Today. A day.
 *
 * The clock this measures is `booking_payments.updated_at`, which for one of
 * these rows is when the money was *captured* — a refund that could not be
 * issued deliberately leaves the payment row untouched, so there is no "we
 * tried and failed at T" stamp to read, and inventing a column to hold one
 * would be the stored flag this queue is built to avoid. So the rule this
 * states is the honest one: money the shop has held for more than a day that
 * now belongs to somebody else. In practice a swept Saturday crosses it almost
 * at once, which is the intent — the diver has already been told the shop will
 * be in touch.
 */
export const OWED_REFUND_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** How many owed refunds one read will return. A panel, not a ledger. */
const OWED_REFUND_LIMIT = 50;

/** One seat whose departure the shop cancelled and whose money never went back. */
export type OwedShopCancellationRefund = {
  bookingId: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
  diverName: string;
  /** Null for a counter mark that recorded no amount — staff know what they took. */
  amountCents: number | null;
  currency: string;
  /** Only the deposit was ever captured, so only the deposit is owed back. */
  depositOnly: boolean;
  /** When this money was last touched; see `OWED_REFUND_STALE_AFTER_MS`. */
  since: Date;
};

/**
 * Money the shop owes divers for departures it cancelled and could not refund
 * automatically.
 *
 * There is no `refund_owed` column and there should not be one. This residue is
 * *derivable* — a seat still holding a capture on a trip that no longer exists —
 * and a stored flag would have to be reconciled with Stripe every time a staff
 * member handed the cash back, which is exactly the drift a queue like this is
 * meant to remove.
 *
 * The predicate mirrors `refundBookingsForShopCancelledTrip`'s own set, seat for
 * seat, so this lists precisely what that cascade left behind and nothing else.
 * In particular it excludes a **cancelled booking**, and that exclusion is
 * load-bearing rather than incidental: a diver who cancelled inside no window
 * forfeited their fare and still reads `paid`, and the shop does not owe them
 * anything just because the departure was later called off
 * (ADR 20260813-shop-cancellation-refunds-itself).
 *
 * A seat that *was* refunded reads `refunded`, not `paid`, so it never appears —
 * the obvious way to get this wrong.
 *
 * Bounded and shop-scoped, like every other back-office reader. Newest money
 * first, so the seat a shop is most likely to be asked about is on top.
 */
export async function listOwedShopCancellationRefunds(
  db: AppDb,
  shopId: string,
  options: { olderThan?: Date; limit?: number } = {},
): Promise<OwedShopCancellationRefund[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      diverName: people.fullName,
      amountCents: bookingPayments.amountCents,
      currency: bookingPayments.currency,
      paymentStatus: bookingPayments.status,
      since: bookingPayments.updatedAt,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, ["paid", "deposit_paid"]),
        eq(trips.status, "cancelled"),
        // The forfeit carve-out — see the doc comment above.
        ne(bookings.status, "cancelled"),
        ...(options.olderThan ? [lt(bookingPayments.updatedAt, options.olderThan)] : []),
      ),
    )
    .orderBy(desc(bookingPayments.updatedAt))
    .limit(options.limit ?? OWED_REFUND_LIMIT);

  return rows.map(({ paymentStatus, ...row }) => ({
    ...row,
    depositOnly: paymentStatus === "deposit_paid",
  }));
}

export async function refundBookingsForShopCancelledTrip(
  db: AppDb,
  input: { shopId: string; tripId: string },
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<Map<string, ShopCancellationRefundOutcome>> {
  const seats = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  const outcomes = new Map<string, ShopCancellationRefundOutcome>();
  for (const seat of seats) {
    outcomes.set(
      seat.id,
      await refundBookingOnShopCancellation(
        db,
        { shopId: input.shopId, bookingId: seat.id },
        checkout,
      ),
    );
  }
  return outcomes;
}
