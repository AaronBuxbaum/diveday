import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { checkoutCharge } from "@/lib/deposits";
import { log } from "@/lib/log";
import {
  type CheckoutProvider,
  checkoutProviderFromEnvironment,
  stripeLineDescription,
} from "@/lib/payments/checkout";
import { allocateSettledTotal, netOfPercentDiscount } from "@/lib/payments/settlement";
import type { AppDb, DbExecutor } from "./client";
import {
  claimBookingsForCheckout,
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  releaseBookingCheckoutClaim,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { setBookingPaymentIfNotFinal } from "./payments";
import type { BookingCheckout } from "./schema";
import { bookingCheckoutBookings, bookingCheckouts, bookings, courses, trips } from "./schema";
import { getShopPromoCodeById, recordShopPromoRedemption } from "./shop-promos";
import { canAcceptPayments, getShopCurrency, getShopStripeAccount } from "./stripe-accounts";

export type StartCheckoutInput = {
  shopId: string;
  tripId: string;
  bookingIds: string[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Priced rental gear a diver chose at booking, one entry per booking that
   * has any (docs ADR 20260801-checkout-upsells-rental-gear). Each becomes its
   * own single-quantity Stripe line alongside the trip-fee line, and is always
   * charged in full — the trip's deposit policy applies only to the trip fee.
   * A bookingId outside `bookingIds`, or a non-positive amount, is dropped
   * rather than trusted.
   */
  gearLines?: Array<{ bookingId: string; description: string; amountCents: number }>;
  /**
   * A Stripe `PromotionCode` id, already resolved and scope-checked by the
   * caller — `getActiveTripPromoByCode` (src/db/trip-promos.ts) for a
   * trip-scoped last-minute deal, or `getRedeemableShopPromo`
   * (src/db/shop-promos.ts) for a shop-wide code — never a raw diver-typed
   * code. Only ever passed on a fresh checkout attempt, not a reuse (docs ADRs
   * 20260727-last-minute-fill-promos, 20260729-shop-promo-codes).
   */
  promotionCode?: string;
  /**
   * The shop-wide promo row behind `promotionCode`, when that's where it came
   * from. Snapshotted onto the checkout so a completed session can record its
   * redemption, and so a later edit to the code can't rewrite what this diver
   * was quoted. Absent for a trip-scoped last-minute code, which has its own row.
   */
  shopPromo?: { id: string; code: string };
  /**
   * The words for the single line on the hosted Stripe page. Supplied by the
   * caller because this layer returns codes, not sentences (docs ADR
   * 20260731-domain-layer-copy-leaks) — but supplied as a *callback* rather
   * than a finished string, because only this function knows two things the
   * caller doesn't: whether the charge is a deposit or the whole fare
   * (`checkoutCharge` decides that here, from the trip's own deposit policy),
   * and the trip's title (looked up below). The caller answers "what would
   * you call it, given these parts?" in its own locale.
   *
   * Whatever it returns is what Stripe shows the diver on the hosted page and
   * keeps on the session and receipt forever, so it is composed once, at
   * checkout time, in the language the diver is reading right then — never
   * re-translated afterwards, which would make our record of the charge
   * disagree with theirs.
   */
  describeLine: (parts: { isDeposit: boolean; tripTitle: string }) => string;
};

export type StartCheckoutOutcome =
  | { ok: true; checkout: BookingCheckout; reused: boolean }
  | { ok: false; reason: "not_connected" | "unpriced" | "invalid" | "checkout_unavailable" };

/**
 * Hand a fresh public booking (or party) a hosted Stripe Checkout on the
 * shop's connected account. Deliberately additive to the capacity-safe
 * booking transaction: the seats are already committed before this runs, so a
 * Stripe failure can only ever degrade to today's book-now-pay-later flow,
 * never to a lost seat or a phantom charge (docs ADR
 * 20260721-checkout-at-booking).
 *
 * Fails closed on anything ambiguous: no connected charges-enabled account,
 * an unpriced trip, or a booking that isn't an active row of this shop+trip.
 * An open, unexpired checkout already covering one of these bookings is
 * reused rather than minting a second Stripe session for the same seats.
 */
export async function startBookingCheckout(
  db: AppDb,
  input: StartCheckoutInput,
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<StartCheckoutOutcome> {
  if (input.bookingIds.length === 0) return { ok: false, reason: "invalid" };

  const account = await getShopStripeAccount(db, input.shopId);
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const [tripRow] = await db
    .select({ trip: trips, course: courses })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
    .limit(1);
  if (!tripRow) return { ok: false, reason: "invalid" };
  const charge = checkoutCharge(tripRow.trip, tripRow.course);
  if (charge === null) return { ok: false, reason: "unpriced" };
  const amountPerDiverCents = charge.amountCents;
  // The shop's own currency, never the connected account's and never a
  // hardcoded "usd" (docs ADR 20260731-shop-currency). `amountPerDiverCents`
  // is already an integer count of this currency's minor unit, so it reaches
  // Stripe unchanged — there is no divisor anywhere on this path.
  const currency = await getShopCurrency(db, input.shopId);

  const bookingRows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.id, input.bookingIds),
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  if (bookingRows.length !== input.bookingIds.length) return { ok: false, reason: "invalid" };

  // Never trust a gear line for a booking outside this exact party, or a
  // non-positive amount — the caller composes these from a diver's own
  // checkbox selections, but this is the boundary that actually charges money.
  const validBookingIds = new Set(input.bookingIds);
  const gearLines = (input.gearLines ?? []).filter(
    (line) => validBookingIds.has(line.bookingId) && line.amountCents > 0,
  );
  const gearCentsByBooking = new Map(gearLines.map((line) => [line.bookingId, line.amountCents]));
  const gearTotalCents = gearLines.reduce((sum, line) => sum + line.amountCents, 0);

  const existing = await latestCheckoutForBookingIds(db, input.shopId, input.bookingIds);
  if (
    existing?.status === "pending" &&
    existing.checkoutUrl &&
    (!existing.expiresAt || existing.expiresAt > nowDate()) &&
    (await checkoutCoversExactly(db, existing.id, input.bookingIds))
  ) {
    return { ok: true, checkout: existing, reused: true };
  }

  // Durable evidence this attempt exists, written and committed before
  // Stripe is ever called (CR-005) — a crash mid-attempt still leaves this
  // row for reconciliation (listStuckPaymentOperations) instead of no trace
  // at all.
  const intent = await startPaymentOperation(db, {
    shopId: input.shopId,
    kind: "checkout_session",
    tripId: input.tripId,
  });

  // Claims every booking in the party for this attempt so a second
  // concurrent start for an overlapping party can never also reach Stripe.
  const claimed = await claimBookingsForCheckout(db, {
    bookingIds: input.bookingIds,
    intentId: intent.id,
  });
  if (!claimed) {
    await resolvePaymentOperation(db, intent.id, {
      status: "failed",
      errorMessage: "booking already has an active checkout attempt",
    });
    return { ok: false, reason: "checkout_unavailable" };
  }

  try {
    const session = await checkout.createCheckoutSession({
      stripeAccountId,
      currency,
      lineItems: [
        {
          // A deposit is labelled as one on the hosted page so the diver knows
          // a balance is still due, not that this is the whole fare — but the
          // words come from the caller's message bundle, not from here.
          description: stripeLineDescription(
            input.describeLine({ isDeposit: charge.isDeposit, tripTitle: tripRow.trip.title }),
          ),
          unitAmountCents: amountPerDiverCents,
          quantity: input.bookingIds.length,
        },
        // One single-quantity line per diver's priced gear, always charged in
        // full — a deposit only ever discounts the trip fee above (docs ADR
        // 20260801-checkout-upsells-rental-gear).
        ...gearLines.map((line) => ({
          description: stripeLineDescription(line.description),
          unitAmountCents: line.amountCents,
          quantity: 1,
        })),
      ],
      customerEmail: input.customerEmail,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      promotionCode: input.promotionCode,
      // Deterministic per-attempt key: a retry of this same intent (a lost
      // response, a redeployed process) converges on the one session Stripe
      // already created instead of minting a second one (CR-005).
      idempotencyKey: idempotencyKeyFor(intent.id),
    });
    if (session.status !== "created") {
      await resolvePaymentOperation(db, intent.id, {
        status: "failed",
        errorMessage: session.status,
      });
      return { ok: false, reason: "checkout_unavailable" };
    }
    // Durable the moment Stripe confirms the session exists — its own
    // committed write, before the local insert below that could still fail.
    // A crash between here and that insert leaves the intent `started` but
    // with a Stripe session id an operator can find and reconcile, instead
    // of nothing at all (CR-005).
    await recordPaymentOperationStripeObject(db, intent.id, session.stripeSessionId);

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(bookingCheckouts)
        .values({
          shopId: input.shopId,
          tripId: input.tripId,
          stripeAccountId,
          stripeSessionId: session.stripeSessionId,
          checkoutUrl: session.checkoutUrl,
          customerEmail: input.customerEmail,
          // Snapshotted, not a foreign key to today's shop setting: this row
          // is evidence of what the diver was asked for. A shop that later
          // switches currency must never reinterpret a settled amount
          // (docs ADR 20260731-shop-currency).
          currency,
          amountPerDiverCents,
          totalCents: amountPerDiverCents * input.bookingIds.length + gearTotalCents,
          isDeposit: charge.isDeposit,
          expiresAt: session.expiresAt,
          promoCodeId: input.shopPromo?.id ?? null,
          promoCode: input.shopPromo?.code ?? null,
        })
        .returning();
      if (!row) throw new Error("startBookingCheckout: insert returned no row");
      await tx.insert(bookingCheckoutBookings).values(
        input.bookingIds.map((bookingId) => ({
          shopId: input.shopId,
          checkoutId: row.id,
          bookingId,
          gearCents: gearCentsByBooking.get(bookingId) ?? 0,
        })),
      );
      return row;
    });
    await resolvePaymentOperation(db, intent.id, { status: "succeeded" });

    return { ok: true, checkout: created, reused: false };
  } finally {
    // The claim's only job was to keep a concurrent attempt out while this
    // one was in flight; once resolved (either way), the checkout's own
    // `pending` status (on success) or the freed claim (on failure) is what
    // future callers check.
    await releaseBookingCheckoutClaim(db, input.bookingIds, intent.id);
  }
}

/** The most recent checkout linked to any of these bookings. */
/**
 * A pending session is only safe to hand out again if it covers exactly the
 * requested party. A changed composition (someone cancelled, someone joined)
 * means a different quantity and total — and completing the old session would
 * mark the *old* linked bookings paid, not the party the diver is looking at.
 */
async function checkoutCoversExactly(
  db: DbExecutor,
  checkoutId: string,
  bookingIds: string[],
): Promise<boolean> {
  const linked = await db
    .select({ bookingId: bookingCheckoutBookings.bookingId })
    .from(bookingCheckoutBookings)
    .where(eq(bookingCheckoutBookings.checkoutId, checkoutId));
  if (linked.length !== bookingIds.length) return false;
  const requested = new Set(bookingIds);
  return linked.every((row) => requested.has(row.bookingId));
}

async function latestCheckoutForBookingIds(
  db: DbExecutor,
  shopId: string,
  bookingIds: string[],
): Promise<BookingCheckout | null> {
  const [row] = await db
    .select({ checkout: bookingCheckouts })
    .from(bookingCheckoutBookings)
    .innerJoin(bookingCheckouts, eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId))
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        inArray(bookingCheckoutBookings.bookingId, bookingIds),
      ),
    )
    .orderBy(desc(bookingCheckouts.createdAt))
    .limit(1);
  return row?.checkout ?? null;
}

/** The most recent checkout for one booking — drives the confirmation page's payment panel. */
export async function getLatestCheckoutForBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<BookingCheckout | null> {
  return latestCheckoutForBookingIds(db, shopId, [bookingId]);
}

/**
 * The most this checkout can have captured, for the branch where Stripe
 * reported no `amount_total` of its own (PAY-M3).
 *
 * `totalCents` is what DiveDay asked for and equals the sum of the per-booking
 * asks, so prorating against it just hands every booking its own ask back —
 * fine for an undiscounted session, wrong for a discounted one, where those
 * shares sum above what the single shared payment intent actually captured and
 * the first party member to cancel can drain more than their share of it.
 *
 * A shop-wide code is reconstructible: `shop_promo_codes.discount_percent` is
 * NOT NULL and constrained to 1..100, and the code snapshotted on this row is
 * by construction the one handed to Stripe (the caller resolves a trip-scoped
 * deal *or* a shop-wide code, never both). A trip-scoped last-minute promo is
 * not — it leaves both promo columns null — so it reads as undiscounted here
 * and keeps the pre-discount behaviour.
 *
 * Reads only rows, never Stripe: this runs inside the completion transaction.
 */
async function attributableTotalCents(db: DbExecutor, checkout: BookingCheckout): Promise<number> {
  if (!checkout.promoCodeId) return checkout.totalCents;
  const promo = await getShopPromoCodeById(db, checkout.shopId, checkout.promoCodeId);
  // A code deleted since (or belonging to another shop) leaves nothing to
  // reconstruct from; the asked total is the only defensible figure left.
  if (!promo) return checkout.totalCents;
  return netOfPercentDiscount(checkout.totalCents, promo.discountPercent);
}

/**
 * Mark a checkout paid from Stripe's own evidence and cascade every covered
 * booking through the shared payment gate, both in one transaction so a
 * crash between the two writes can never leave the checkout "completed"
 * with a booking still unpaid. Idempotent and self-healing: an
 * already-completed checkout still re-runs the booking cascade (rather than
 * short-circuiting), so a replay repairs a booking-payment write that failed
 * after an earlier run's status update committed, instead of silently
 * no-op'ing forever. A booking already refunded or waived is never regressed
 * back to paid by a duplicate or out-of-order webhook (CR-004).
 */
export async function markCheckoutPaidBySessionId(
  db: AppDb,
  stripeSessionId: string,
  expectedAccountId?: string,
  /**
   * Stripe's own `amount_total` for the completed session — what actually
   * settled, after any discount Stripe applied. Recorded on the checkout and
   * split across the covered bookings below. Undefined/null means Stripe
   * reported no total (or the caller has none to offer, e.g. an internal
   * repair run): the covered bookings fall back to the amounts they were
   * asked for rather than being recorded as paying nothing.
   */
  settledTotalCents?: number | null,
): Promise<BookingCheckout | null> {
  return db.transaction(async (tx) => {
    const [checkout] = await tx
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, stripeSessionId))
      .limit(1);
    if (!checkout) return null;
    // Defense-in-depth (security review finding): a Stripe session id is
    // already globally unique across every connected account, so this
    // should never actually disagree, but cross-check the webhook event's
    // own account against the row it matched rather than trusting the id
    // match alone. `expectedAccountId === undefined` opts out (tests, an
    // internal caller with no event to cross-check).
    if (expectedAccountId !== undefined && expectedAccountId !== checkout.stripeAccountId) {
      log("checkout.paid_account_mismatch", "error", {
        checkoutId: checkout.id,
        shopId: checkout.shopId,
        expectedAccountId,
        checkoutAccountId: checkout.stripeAccountId,
      });
      return null;
    }

    // Anything besides `pending`/`completed` (most commonly `expired`) means
    // this checkout was already terminally disqualified locally — a departed
    // or cancelled trip, a booking that settled elsewhere, or (Codex finding)
    // a destination seat reactivated after this exact session was retired on
    // reschedule (`rescheduleBooking`, src/db/bookings.ts). Our local
    // `expired` write and Stripe's own session lifecycle are two separate
    // clocks: Stripe's hosted session can still genuinely be completed by an
    // old tab well after we've locally moved on, so a completion event
    // arriving for a disqualified checkout must never resurrect it into
    // `completed` and attribute a stale, no-longer-applicable price to
    // whatever the booking is now. `refreshCheckoutFromStripe` already
    // enforces this same "pending or completed only" invariant before ever
    // asking Stripe; this brings the webhook path in line with it. Note this
    // does NOT early-return on `completed` — a replay after a prior partial
    // run (checkout marked completed, but the payment write below never
    // landed) still needs to fall through and repair it below.
    if (checkout.status !== "pending" && checkout.status !== "completed") {
      log("checkout.paid_disqualified", "error", {
        shopId: checkout.shopId,
        checkoutId: checkout.id,
        stripeSessionId: checkout.stripeSessionId,
        localStatus: checkout.status,
      });
      return null;
    }

    // Stripe's reported total, kept only when it is a usable figure. An
    // already-recorded settled total is never overwritten — the first
    // completion's evidence stands; a later delivery may only fill in a null.
    const reportedSettledCents =
      settledTotalCents !== undefined &&
      settledTotalCents !== null &&
      Number.isInteger(settledTotalCents) &&
      settledTotalCents >= 0
        ? settledTotalCents
        : null;
    // …and never above what this session actually asked for. Above that
    // ceiling `allocateSettledTotal` scales *every* share up past its own ask
    // (its proportional split has no way to decide whose the surplus is), and
    // the inflated `booking_payments.amountCents` that results is the figure a
    // later refund reverses. No path reaches this today — the session is built
    // from fixed `price_data` lines with no tax, no adjustable quantity, no
    // tipping — and the figure is authenticated before it is trusted, so a
    // mismatch means a Stripe-side assumption has changed (`automatic_tax`, a
    // tipping toggle) rather than an attack. Clamped so that change surfaces as
    // a log line instead of as money, and clamped *before* the store so the
    // per-booking rows still sum to exactly the recorded settled total; the
    // figure Stripe reported stays recoverable from the log.
    if (reportedSettledCents !== null && reportedSettledCents > checkout.totalCents) {
      log("checkout.settled_total_over_asked", "error", {
        shopId: checkout.shopId,
        checkoutId: checkout.id,
        stripeSessionId: checkout.stripeSessionId,
        reportedCents: reportedSettledCents,
        askedCents: checkout.totalCents,
      });
    }
    const usableSettledCents =
      reportedSettledCents === null ? null : Math.min(reportedSettledCents, checkout.totalCents);
    const settledCents = checkout.settledTotalCents ?? usableSettledCents;

    const updated =
      checkout.status === "completed"
        ? // A replay over an already-completed checkout still backfills a
          // settled total the original completion never had (an older webhook
          // payload, an internal repair run), so the repaired payment rows
          // below are written from Stripe's figure rather than the asked one.
          checkout.settledTotalCents === null && settledCents !== null
          ? ((
              await tx
                .update(bookingCheckouts)
                .set({ settledTotalCents: settledCents })
                .where(eq(bookingCheckouts.id, checkout.id))
                .returning()
            )[0] ?? null)
          : checkout
        : ((
            await tx
              .update(bookingCheckouts)
              .set({
                status: "completed",
                completedAt: nowDate(),
                settledTotalCents: settledCents,
              })
              .where(eq(bookingCheckouts.id, checkout.id))
              .returning()
          )[0] ?? null);
    if (!updated) return null;

    const linked = await tx
      .select({
        bookingId: bookingCheckoutBookings.bookingId,
        gearCents: bookingCheckoutBookings.gearCents,
      })
      .from(bookingCheckoutBookings)
      .where(eq(bookingCheckoutBookings.checkoutId, checkout.id));

    // What each diver actually paid, not what they were quoted. The session's
    // asked total is the sum of these per-booking asks (trip fee + that
    // diver's own gear) — by construction the same figure as `totalCents` —
    // and the settled total is split back across them in proportion, so a
    // promo discount lands on everyone it discounted and gear money is
    // attributed to the diver who rented it (PAY-H1/H2).
    const askedCentsFor = (gearCents: number) => checkout.amountPerDiverCents + gearCents;
    // The one figure every per-booking amount is derived from. Stripe's own
    // settled total whenever there is one; otherwise the most this session can
    // have captured, worked out locally (PAY-M3, `attributableTotalCents`).
    // Always a number, so a completion is never refused and never recorded as
    // zero for want of a settled figure.
    const attributableCents =
      updated.settledTotalCents ?? (await attributableTotalCents(tx, updated));
    const allocation = allocateSettledTotal(
      linked.map((row) => ({ key: row.bookingId, askedCents: askedCentsFor(row.gearCents) })),
      attributableCents,
    );
    // A diver's own self-service cancel/reschedule (docs ADR
    // 20260727-diver-self-service-cancel) can leave this exact session still
    // open and payable in another tab; if they complete it after cancelling,
    // the booking it was for no longer exists to be marked paid. Attributing
    // captured money to a cancelled booking would read as "this seat is paid
    // for" when there's no seat. That check now lives inside
    // `setBookingPaymentIfNotFinal` itself, re-verified under the same lock
    // that guards the write — a plain SELECT here, before that lock is
    // acquired, would leave the same race the lock exists to close (Codex
    // finding). (The checkout itself is still marked completed above, so a
    // retried webhook delivery doesn't reprocess it.)
    // A shop-wide code this session actually spent. Written here, inside the
    // same transaction, and deduped on `checkout_id`, so a retried webhook
    // delivery or a repair run over an already-completed checkout lands on the
    // existing row rather than counting the redemption twice
    // (docs ADR 20260729-shop-promo-codes).
    if (updated.promoCodeId) {
      await recordShopPromoRedemption(tx, {
        shopId: updated.shopId,
        promoCodeId: updated.promoCodeId,
        checkoutId: updated.id,
        // What the shop actually received with this code applied, straight
        // from Stripe; with no settled figure, the total net of this code's
        // own discount — never the pre-discount amount the diver was quoted,
        // which would overstate every un-settled redemption in the history
        // this page reports on (PAY-M3).
        amountChargedCents: attributableCents,
      });
    }

    for (const { bookingId, gearCents } of linked) {
      await setBookingPaymentIfNotFinal(tx, {
        shopId: checkout.shopId,
        bookingId,
        // A deposit checkout clears the readiness gate as deposit_paid; the
        // balance is collected later (staff order or a full checkout).
        status: checkout.isDeposit ? "deposit_paid" : "paid",
        // This diver's share of `attributableCents` above. With no discount
        // that is exactly what they were asked for (the split of a total equal
        // to the sum of the asks returns each ask unchanged); with a
        // reconstructible discount it is their share of what the session can
        // actually have captured, which is what a later refund may reverse.
        //
        // Remaining gap, stated: a **trip-scoped last-minute promo** leaves
        // both promo columns null (it is Stripe's object end to end), so on the
        // no-`amount_total` branch it is indistinguishable from an undiscounted
        // checkout and still records pre-discount shares. Closing it needs the
        // applied promotion snapshotted on the checkout row, i.e. a schema
        // change. Every other class — no discount, a shop-wide code, and any
        // session Stripe reported a total for (all three production paths do)
        // — is covered.
        amountCents: allocation.get(bookingId) ?? askedCentsFor(gearCents),
        currency: checkout.currency,
        provider: "stripe",
        providerRef: checkout.stripeSessionId,
      });
    }
    return updated;
  });
}

/** A Stripe-expired session can no longer be paid; pending → expired, payments untouched. */
export async function markCheckoutExpiredBySessionId(
  db: AppDb,
  stripeSessionId: string,
  expectedAccountId?: string,
): Promise<BookingCheckout | null> {
  const [updated] = await db
    .update(bookingCheckouts)
    .set({ status: "expired" })
    .where(
      and(
        eq(bookingCheckouts.stripeSessionId, stripeSessionId),
        eq(bookingCheckouts.status, "pending"),
        // Defense-in-depth account cross-check (security review finding) —
        // see markCheckoutPaidBySessionId. A no-op condition when
        // expectedAccountId is undefined.
        expectedAccountId === undefined
          ? undefined
          : eq(bookingCheckouts.stripeAccountId, expectedAccountId),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * The webhook-less fallback, mirroring refreshOrderStatus: when the diver
 * lands back on the confirmation page with a checkout still pending, ask
 * Stripe directly. Payment state comes from the API response alone — the
 * return URL proves nothing (anyone can type it).
 */
export async function refreshCheckoutFromStripe(
  db: AppDb,
  shopId: string,
  checkoutId: string,
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<BookingCheckout | null> {
  const [row] = await db
    .select()
    .from(bookingCheckouts)
    .where(and(eq(bookingCheckouts.id, checkoutId), eq(bookingCheckouts.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  if (row.status !== "pending") return row;

  const result = await checkout.retrieveCheckoutSession(row.stripeAccountId, row.stripeSessionId);
  if (result.status !== "ok") return row;
  if (result.session.paymentStatus === "paid") {
    // The snapshot already carries Stripe's own settled total; pass it through
    // rather than dropping it, so this fallback path records the same money
    // the webhook path would have (PAY-H1/H2).
    return markCheckoutPaidBySessionId(
      db,
      row.stripeSessionId,
      undefined,
      result.session.amountTotalCents,
    );
  }
  if (result.session.stripeStatus === "expired") {
    return markCheckoutExpiredBySessionId(db, row.stripeSessionId);
  }
  return row;
}
