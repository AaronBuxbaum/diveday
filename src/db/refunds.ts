import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { refundOnCancellation } from "@/lib/deposits";
import { capturedPaymentStatuses, isCapturedPaymentStatus } from "@/lib/payment-source";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import { releasePackageCoverageForBooking } from "./bookings";
import type { AppDb, AppTransaction } from "./client";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  STALE_AFTER_MS,
  startPaymentOperation,
} from "./payment-operations";
import { getBookingPayment, setBookingPayment } from "./payments";
import type { BookingPayment, PaymentOperationIntent } from "./schema";
import {
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  paymentOperationIntents,
  people,
  trips,
} from "./schema";
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
  /**
   * Another refund of this same seat is already at Stripe. Refused *locally*
   * rather than sent as a second reversal — see {@link claimBookingRefund}.
   */
  | { status: "in_progress" }
  /**
   * A previous attempt got a refund out of Stripe and then failed to record it.
   * A human reconciles that against the Stripe dashboard; this never reverses
   * more money on top of it — see {@link claimBookingRefund}.
   */
  | { status: "needs_reconciliation" }
  /** Stripe was asked to refund and failed; staff should retry. */
  | { status: "failed" };

export type RefundOnCancellationInput = {
  shopId: string;
  bookingId: string;
  /** Injectable for tests; defaults to now. */
  now?: Date;
  /** See {@link claimBookingRefund} — the abandoned-attempt horizon, for tests. */
  staleBefore?: Date;
};

/** Everything the Stripe call needs, decided under the booking's own lock. */
type BookingRefundPlan = {
  refundCents: number;
  stripeAccountId: string;
  /** The captured Stripe object this reversal is taken against. */
  providerRef: string;
  currency: string;
};

/**
 * What one refund path decided about a booking's money, inside the lock —
 * either a plan to send Stripe, or the outcome that path answers with instead.
 * Generic in the outcome because the two callers refuse for different reasons:
 * a diver cancelling can be `forfeit`, a shop cancelling never can.
 */
type BookingRefundDecision<Outcome> =
  | { proceed: true; plan: BookingRefundPlan }
  | { proceed: false; outcome: Outcome };

type BookingRefundClaim<Outcome> =
  | { status: "claimed"; intent: PaymentOperationIntent; plan: BookingRefundPlan }
  | { status: "not_found" | "in_progress" | "needs_reconciliation" }
  | { status: "refused"; outcome: Outcome };

/**
 * Claim the sole in-flight refund of one *booking*, under that booking row's
 * own lock — the booking-level twin of `claimOrderRefund` (src/db/orders.ts).
 *
 * Before this, both cancellation paths read the seat's retained balance with a
 * plain `getBookingPayment`, minted an intent — and therefore a fresh
 * `Idempotency-Key` — and called Stripe, with no lock held across the three.
 * Two concurrent cancellations of one booking both passed the balance read,
 * presented Stripe two different keys, and Stripe accepted both whenever the
 * underlying charge still had capacity. On a **shared party checkout** it does:
 * one payment intent covers several seats, so a per-seat reversal never
 * exhausts it, and one seat is refunded twice out of another seat's money while
 * that other seat still reads `paid` (issue #950). The race is older than the
 * partial-refund work — `git show 000b2bcc^:src/db/refunds.ts` has the same
 * shape — so it applied to a plain `paid` seat exactly as it does now.
 *
 * **The lock is on `bookings`, not `booking_payments`**, for the reason
 * `withBookingPaymentLock` (src/db/payments.ts) already states: `SELECT …
 * FOR UPDATE` on a row that does not exist yet takes no lock at all in
 * Postgres, and a booking's payment row is exactly the sort that may be
 * absent. The `bookings` row always exists, and it is the row every other
 * writer of this seat's money already serializes on.
 *
 * The whole money decision — is anything captured, does the window still hold,
 * how much comes back — runs inside the lock, in `decide`, because that
 * decision is read off the balance the lock exists to protect. What stays
 * outside is the Stripe call itself: the transaction commits **before** the
 * network round trip, never around it, which keeps `startPaymentOperation`'s
 * durability contract intact (CR-005) — a crash mid-call still leaves a
 * committed intent for `listStuckPaymentOperations` to surface.
 *
 * A claim is a guard for the duration of one Stripe round trip, never a
 * permanent lock: an intent still `started` past `STALE_AFTER_MS` belonged to a
 * process that died and is ignored, exactly as `claimBookingsForCheckout` and
 * `claimOrderRefund` treat theirs. The one exception is a stale intent carrying
 * a `stripeObjectId` — that column is written the moment Stripe confirms a
 * refund exists, so it is durable evidence money already moved and only the
 * local write after it failed. Minting a fresh intent for it would mint a fresh
 * idempotency key (deliberately, PAY-C1) and Stripe would accept a second
 * reversal against the balance still on the charge, which on a party checkout
 * is somebody else's fare. It belongs on the stuck-payment-operations panel,
 * where a human reconciles it, and answers `needs_reconciliation` here.
 *
 * **PGlite caveat**, the same one `claimOrderRefund` carries: the default test
 * database is single-connection, so `FOR UPDATE` never blocks there and the
 * PGlite suite would stay green with the lock deleted. What those tests pin is
 * the ordering and the refusal codes; the lock's *presence* is asserted under
 * real contention in `src/db/refunds.postgres.test.ts`.
 *
 * `staleBefore` is injectable for the same reason `claimOrderRefund`'s is:
 * `payment_operation_intents.started_at` is stamped by the *database's* clock,
 * which `DIVEDAY_CLOCK` does not freeze.
 */
async function claimBookingRefund<Outcome>(
  db: AppDb,
  input: { shopId: string; bookingId: string; staleBefore?: Date },
  decide: (
    tx: AppTransaction,
    payment: BookingPayment | null,
  ) => Promise<BookingRefundDecision<Outcome>>,
): Promise<BookingRefundClaim<Outcome>> {
  const staleBefore = input.staleBefore ?? new Date(nowDate().getTime() - STALE_AFTER_MS);
  const refundIntentsForThisBooking = and(
    eq(paymentOperationIntents.shopId, input.shopId),
    eq(paymentOperationIntents.bookingId, input.bookingId),
    eq(paymentOperationIntents.kind, "refund"),
    eq(paymentOperationIntents.status, "started"),
  );
  return db.transaction(async (tx): Promise<BookingRefundClaim<Outcome>> => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .for("update");
    if (!booking) return { status: "not_found" };

    // Read under the lock, never before it: this balance is what the decision
    // below is made of, and a value read outside could describe money a
    // concurrent reversal has already taken.
    const payment = await getBookingPayment(tx, input.shopId, input.bookingId);
    const decision = await decide(tx, payment);
    if (!decision.proceed) return { status: "refused", outcome: decision.outcome };

    const [live] = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(and(refundIntentsForThisBooking, gte(paymentOperationIntents.startedAt, staleBefore)))
      .limit(1);
    if (live) return { status: "in_progress" };

    const [settledByStripe] = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(and(refundIntentsForThisBooking, isNotNull(paymentOperationIntents.stripeObjectId)))
      .limit(1);
    if (settledByStripe) return { status: "needs_reconciliation" };

    const intent = await startPaymentOperation(tx, {
      shopId: input.shopId,
      kind: "refund",
      bookingId: input.bookingId,
    });
    return { status: "claimed", intent, plan: decision.plan };
  });
}

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

  // Every read the money decision is made of happens inside the booking's own
  // lock, and the intent — this refund's Idempotency-Key — is minted there too,
  // so a second concurrent cancellation of this seat is refused locally instead
  // of presenting Stripe a second key against the same charge (issue #950).
  // Each *distinct* refund still gets its own key, deliberately: a second party
  // member cancelling for the same amount off the same payment intent is a
  // second, genuine refund rather than a replay of the first (PAY-C1).
  const claim = await claimBookingRefund<CancellationRefundOutcome>(
    db,
    { shopId: input.shopId, bookingId: input.bookingId, staleBefore: input.staleBefore },
    async (tx, payment) => {
      if (!isCapturedPaymentStatus(payment?.status)) {
        return { proceed: false, outcome: { status: "unpaid" } };
      }

      const decision = refundOnCancellation(row.trip, payment.amountCents ?? 0, now);
      if (decision.outcome === "no_policy") {
        return { proceed: false, outcome: { status: "no_policy" } };
      }
      if (decision.outcome === "forfeit") return { proceed: false, outcome: { status: "forfeit" } };

      // A refund is owed. Only a Stripe-captured payment can be auto-reversed
      // here; a counter/cash mark (provider not "stripe", commonly with no
      // recorded amount) is owed a refund too but staff must issue it — never
      // silently drop it as "unpaid" just because the amount wasn't recorded.
      if (payment.provider !== "stripe" || !payment.providerRef) {
        return { proceed: false, outcome: { status: "manual", reason: "not_stripe" } };
      }
      if (decision.refundCents <= 0) {
        // A Stripe payment with no recorded amount shouldn't happen; don't fire
        // a zero/blank refund — hand it to staff to reconcile.
        return { proceed: false, outcome: { status: "manual", reason: "not_refundable" } };
      }

      const account = await getShopStripeAccount(tx, input.shopId);
      if (!account || !canAcceptPayments(account)) {
        return { proceed: false, outcome: { status: "manual", reason: "not_connected" } };
      }
      return {
        proceed: true,
        plan: {
          refundCents: decision.refundCents,
          stripeAccountId: account.stripeAccountId,
          providerRef: payment.providerRef,
          currency: payment.currency,
        },
      };
    },
  );
  if (claim.status === "refused") return claim.outcome;
  // The booking was read above, so a disappearance between the two is a fault
  // rather than a policy answer.
  if (claim.status === "not_found") return { status: "failed" };
  if (claim.status !== "claimed") return { status: claim.status };
  const { intent, plan } = claim;

  const result = await checkout.refundCheckoutSession(
    plan.stripeAccountId,
    plan.providerRef,
    idempotencyKeyFor(intent.id),
    plan.refundCents,
  );
  if (result.status === "refunded") {
    // Durable the moment Stripe confirms the refund exists — before the
    // local payment-row update below that could still fail (CR-005).
    if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
    await setBookingPayment(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: "refunded",
      amountCents: plan.refundCents,
      currency: plan.currency,
      provider: "stripe",
      providerRef: result.refundId ?? plan.providerRef,
      note: "Auto-refunded on cancellation within the free window",
      // The capture this reverses is overwritten in `booking_payments`; the
      // append-only trail is where it survives (ADR
      // 20260803-booking-payment-events).
      operation: "cancellation_refund",
    });
    await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
    return { status: "refunded", amountCents: plan.refundCents };
  }
  // Left `started` only when Stripe answered *and* said no; a reversal Stripe
  // did make has its id recorded above, and a crash before this line leaves the
  // intent for `listStuckPaymentOperations` and for the reconciliation refusal
  // in `claimBookingRefund`.
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
  /** Package tanks were returned; no cash refund is owed. */
  | { status: "dive_returned" }
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
  /**
   * Another refund of this same seat is already at Stripe — a resumed cascade
   * racing the sweep, say. Refused *locally* rather than sent as a second
   * reversal (see {@link claimBookingRefund}). Distinct from
   * `already_refunded`, which is a reversal that has already landed.
   */
  | { status: "in_progress" }
  /**
   * A previous attempt got a refund out of Stripe and then failed to record it.
   * A human reconciles that against the Stripe dashboard; this never reverses
   * more money on top of it — see {@link claimBookingRefund}.
   */
  | { status: "needs_reconciliation" }
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
  input: { shopId: string; bookingId: string; staleBefore?: Date },
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<ShopCancellationRefundOutcome> {
  // The booking must be this shop's — the lock `claimBookingRefund` takes is
  // scoped to the shop, so a foreign caller finds no row and moves no money,
  // and answers `failed` rather than the misleading `unpaid`. Everything the
  // money decision is made of is read inside that lock; see #950.
  const claim = await claimBookingRefund<ShopCancellationRefundOutcome>(
    db,
    input,
    async (tx, payment) => {
      const released = await releasePackageCoverageForBooking(tx, input.shopId, input.bookingId);
      if (released.length > 0 && payment?.provider === "dive_package") {
        return { proceed: false, outcome: { status: "dive_returned" } };
      }
      if (payment?.status === "refunded") {
        return { proceed: false, outcome: { status: "already_refunded" } };
      }
      if (!isCapturedPaymentStatus(payment?.status)) {
        const [packageConsumption] = await tx
          .select({ id: bookingPaymentEvents.id })
          .from(bookingPaymentEvents)
          .where(
            and(
              eq(bookingPaymentEvents.shopId, input.shopId),
              eq(bookingPaymentEvents.bookingId, input.bookingId),
              eq(bookingPaymentEvents.operation, "package_consumed"),
            ),
          )
          .limit(1);
        if (packageConsumption) {
          return { proceed: false, outcome: { status: "dive_returned" } };
        }
        return { proceed: false, outcome: { status: "unpaid" } };
      }

      // A refund is owed unconditionally. Only a Stripe capture can be reversed
      // from here; a counter/cash mark is owed one too, and staff issue it.
      if (payment.provider !== "stripe" || !payment.providerRef) {
        return { proceed: false, outcome: { status: "manual", reason: "not_stripe" } };
      }
      const refundCents = payment.amountCents ?? 0;
      if (refundCents <= 0) {
        // A Stripe payment with no recorded amount shouldn't happen; don't fire
        // a zero/blank refund — hand it to staff to reconcile.
        return { proceed: false, outcome: { status: "manual", reason: "not_refundable" } };
      }

      const account = await getShopStripeAccount(tx, input.shopId);
      if (!account || !canAcceptPayments(account)) {
        return { proceed: false, outcome: { status: "manual", reason: "not_connected" } };
      }
      return {
        proceed: true,
        plan: {
          refundCents,
          stripeAccountId: account.stripeAccountId,
          providerRef: payment.providerRef,
          currency: payment.currency,
        },
      };
    },
  );
  if (claim.status === "refused") return claim.outcome;
  if (claim.status === "not_found") return { status: "failed" };
  if (claim.status !== "claimed") return { status: claim.status };
  const { intent, plan } = claim;

  const result = await checkout.refundCheckoutSession(
    plan.stripeAccountId,
    plan.providerRef,
    idempotencyKeyFor(intent.id),
    plan.refundCents,
  );
  if (result.status === "refunded") {
    if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
    await setBookingPayment(db, {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: "refunded",
      amountCents: plan.refundCents,
      currency: plan.currency,
      provider: "stripe",
      providerRef: result.refundId ?? plan.providerRef,
      note: "Auto-refunded: the shop cancelled this departure",
      operation: "shop_cancellation_refund",
    });
    await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
    return { status: "refunded", amountCents: plan.refundCents };
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
 * payment, a disconnected account, a Stripe refusal, a failure, a reversal
 * another pass is already making (`in_progress`), and one a human has to
 * reconcile against Stripe (`needs_reconciliation`). The diver reads the same
 * honest sentence in all of them — the shop owes them money and will be in
 * touch — because the difference between them is the shop's problem to solve,
 * not the diver's to understand. In particular `in_progress` is *not* told as
 * `refunded`: the pass that holds the claim may still fail, and a diver told
 * their money is on its way must not depend on that.
 */
export function shopCancellationPaymentStory(
  outcome: ShopCancellationRefundOutcome,
): "none" | "refunded" | "refund_owed" {
  if (outcome.status === "unpaid" || outcome.status === "dive_returned") return "none";
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
 * The clock this measures is `trips.cancelled_at` — when the shop called the
 * departure off, which is when the money became owed. That is the rule the name
 * has always implied, and until 2026-08-14 it was not the rule the code ran:
 * the bound compared against `booking_payments.updated_at`, which for these rows
 * is when the diver *paid*. The two come apart in both directions. A Saturday
 * charter everyone paid for weeks ago was instantly past the bound, so the delay
 * did not exist; a walk-in who paid cash on Friday morning for a Friday-evening
 * dive that blew out that afternoon stayed hidden until Saturday, even though it
 * is the freshest and most-likely-to-be-asked-about money on the list.
 *
 * `cancelled_at` is a fact about the departure, not a state about the money —
 * there is still no "we tried to refund and failed at T" flag, and there must
 * not be one: this queue is derivable on purpose so that a staffer handing back
 * cash by hand leaves nothing to reconcile with Stripe.
 *
 * A trip cancelled before that column existed has a null, and a null is treated
 * as **stale**: it has been owed for a while by definition, and failing toward
 * showing the money is the right direction to fail.
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
      // When the money became owed, which is when the shop called the trip off
      // -- not when the diver paid. `cancelledAt` is null only for departures
      // cancelled before that column existed, and those fall back to the
      // payment stamp so the panel still has a date to show.
      since: sql<Date>`coalesce(${trips.cancelledAt}, ${bookingPayments.updatedAt})`,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, [...capturedPaymentStatuses]),
        eq(trips.status, "cancelled"),
        // The forfeit carve-out — see the doc comment above.
        ne(bookings.status, "cancelled"),
        // Bounded on the cancellation, with a NULL treated as **stale**: a trip
        // cancelled before this column existed has been owed for a while by
        // definition, and failing toward showing the money is the right
        // direction to fail.
        ...(options.olderThan
          ? [
              or(
                isNull(trips.cancelledAt),
                lt(trips.cancelledAt, options.olderThan),
              ) as SQL<unknown>,
            ]
          : []),
      ),
    )
    .orderBy(desc(sql`coalesce(${trips.cancelledAt}, ${bookingPayments.updatedAt})`))
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
