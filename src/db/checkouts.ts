import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { checkoutCharge } from "@/lib/deposits";
import { log } from "@/lib/log";
import { capturedPaymentStatuses } from "@/lib/payment-source";
import {
  type CheckoutProvider,
  checkoutProviderFromEnvironment,
  stripeLineDescription,
} from "@/lib/payments/checkout";
import { allocateSettledTotal, netOfPercentDiscount } from "@/lib/payments/settlement";
import type { AppDb, DbExecutor } from "./client";
import { countConsumedEntitlementsForBookings } from "./dive-packages";
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
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  courses,
  trips,
} from "./schema";
import { getShopPromoCodeById, recordShopPromoRedemption } from "./shop-promos";
import { canAcceptPayments, getShopCurrency, getShopStripeAccount } from "./stripe-accounts";
import { liveTrip } from "./trips-live";

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
   * was quoted. Absent for a trip-scoped last-minute code, which arrives on
   * `tripPromo` below instead.
   */
  shopPromo?: { id: string; code: string; discountPercent: number };
  /**
   * The trip-scoped last-minute deal behind `promotionCode`, when *that's*
   * where it came from (`getActiveTripPromoByCode`, src/db/trip-promos.ts).
   * The counterpart to `shopPromo`; the caller resolves one or the other, never
   * both.
   *
   * Snapshotted for the same reason `shopPromo` is, plus one this flavor made
   * unavoidable: a trip deal is Stripe's object end to end, so before this it
   * left no local trace on the checkout at all and a completion carrying no
   * `amount_total` could not tell a discounted session from an undiscounted
   * one — and recorded the party at pre-discount amounts, above what the one
   * shared payment intent had actually captured (PAY-M3).
   */
  tripPromo?: { id: string; code: string; discountPercent: number };
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
  | {
      ok: false;
      reason: "not_connected" | "unpriced" | "invalid" | "checkout_unavailable" | "already_paid";
    };

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
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
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

  const consumedByBooking = await countConsumedEntitlementsForBookings(
    db,
    input.shopId,
    input.bookingIds,
  );
  const tripCentsByBooking = new Map(
    bookingRows.map((row) => {
      const consumed = consumedByBooking.get(row.id) ?? 0;
      const uncovered = Math.max(0, tripRow.trip.plannedDives - consumed);
      const tripCents = Math.ceil((charge.amountCents * uncovered) / tripRow.trip.plannedDives);
      return [row.id, tripCents] as const;
    }),
  );

  // Nothing here may charge a seat the shop has already taken money for. Until
  // now the only thing standing between a diver and a second full charge was
  // `canPay` on the /ready page — a UI boolean, on a page reached by a
  // capability URL that is shared by design. `partly_refunded` is the state
  // that made that gap reachable (it settles, but was absent from `canPay`
  // until issue #699's security review), and `paid` was one forgotten
  // condition away from the same thing. This is the boundary that actually
  // charges money, so it asks for itself.
  const settledRows = await db
    .select({ id: bookingPayments.bookingId })
    .from(bookingPayments)
    .where(
      and(
        eq(bookingPayments.shopId, input.shopId),
        inArray(bookingPayments.bookingId, input.bookingIds),
        inArray(bookingPayments.status, [...capturedPaymentStatuses, "waived"]),
      ),
    )
    .limit(1);
  if (settledRows.length > 0) return { ok: false, reason: "already_paid" };

  // Never trust a gear line for a booking outside this exact party, or a
  // non-positive amount — the caller composes these from a diver's own
  // checkbox selections, but this is the boundary that actually charges money.
  const validBookingIds = new Set(input.bookingIds);
  const gearLines = (input.gearLines ?? []).filter(
    (line) => validBookingIds.has(line.bookingId) && line.amountCents > 0,
  );
  const gearCentsByBooking = new Map(gearLines.map((line) => [line.bookingId, line.amountCents]));
  const gearTotalCents = gearLines.reduce((sum, line) => sum + line.amountCents, 0);

  // The promotion this attempt is actually *applying* — snapshotted onto the
  // row below so the discount stays reconstructible later without a network
  // call (PAY-M3). Gated on `promotionCode`, the thing Stripe is genuinely
  // told about: a promo the caller merely resolved but never handed over
  // discounts nothing, and recording it would understate what this session
  // captured. Trip deal first, mirroring the caller's own resolution order;
  // the two are mutually exclusive (a check constraint on the table holds it).
  const appliedPromo = input.promotionCode
    ? input.tripPromo
      ? ({ source: "trip", ...input.tripPromo } as const)
      : input.shopPromo
        ? ({ source: "shop", ...input.shopPromo } as const)
        : null
    : null;

  const totalCents =
    [...tripCentsByBooking.values()].reduce((sum, cents) => sum + cents, 0) + gearTotalCents;
  if (totalCents === 0) return { ok: false, reason: "already_paid" };
  const tripLineQuantities = new Map<number, number>();
  for (const cents of tripCentsByBooking.values()) {
    if (cents > 0) tripLineQuantities.set(cents, (tripLineQuantities.get(cents) ?? 0) + 1);
  }

  const existing = await latestCheckoutForBookingIds(db, input.shopId, input.bookingIds);
  if (
    existing?.status === "pending" &&
    existing.checkoutUrl &&
    (!existing.expiresAt || existing.expiresAt > nowDate()) &&
    (await checkoutCoversExactly(db, input.shopId, existing.id, input.bookingIds))
  ) {
    // …and only if the diver would still be charged what it was minted for
    // (PAY-L2). Stripe holds a session's amounts for its whole life, so a
    // reprice, a new deposit policy, a currency switch, changed gear or a code
    // the diver has only just entered all leave this row quoting a figure the
    // shop is no longer asking for.
    if (
      stillQuotesCurrentCharge(existing, {
        amountPerDiverCents,
        totalCents,
        isDeposit: charge.isDeposit,
        currency,
        appliedDiscountPercent: appliedPromo?.discountPercent ?? null,
        promoResolved: input.promotionCode !== undefined,
      })
    ) {
      return { ok: true, checkout: existing, reused: true };
    }
    // Retire it before minting the replacement, and unconditionally — a Stripe
    // failure below must not leave the stale figure payable as a consolation
    // prize; it is retired precisely *because* its figure is wrong, and an
    // outage does not make it right. Local only, like every other retirement on
    // this path (`rescheduleBooking`, src/db/bookings.ts): the hosted session
    // stays genuinely completable at Stripe until its own longer expiry, and
    // what actually closes that loophole is `markCheckoutPaidBySessionId`
    // refusing to settle a checkout whose local status is no longer `pending`.
    await retireStaleCheckout(db, existing);
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
        ...[...tripLineQuantities].map(([tripCents, quantity]) => ({
          description: stripeLineDescription(
            input.describeLine({ isDeposit: charge.isDeposit, tripTitle: tripRow.trip.title }),
          ),
          unitAmountCents: tripCents,
          quantity,
        })),
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
          totalCents,
          isDeposit: charge.isDeposit,
          expiresAt: session.expiresAt,
          // At most one source is ever recorded (the table's
          // `single_promo_source` check holds it): if a trip deal is what
          // Stripe applied, the shop-wide code was not spent and has no
          // redemption to record against it.
          promoCodeId: appliedPromo?.source === "trip" ? null : (input.shopPromo?.id ?? null),
          tripPromoId: appliedPromo?.source === "trip" ? appliedPromo.id : null,
          promoCode: appliedPromo?.code ?? input.shopPromo?.code ?? null,
          appliedDiscountPercent: appliedPromo?.discountPercent ?? null,
        })
        .returning();
      if (!row) throw new Error("startBookingCheckout: insert returned no row");
      await tx.insert(bookingCheckoutBookings).values(
        input.bookingIds.map((bookingId) => ({
          shopId: input.shopId,
          checkoutId: row.id,
          bookingId,
          tripCents: tripCentsByBooking.get(bookingId) ?? 0,
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

/** What a fresh attempt right now would charge, for comparison against a stored session. */
type CurrentCharge = {
  amountPerDiverCents: number;
  totalCents: number;
  isDeposit: boolean;
  currency: string;
  /** The percent this attempt would hand Stripe, or null for no discount. */
  appliedDiscountPercent: number | null;
  /**
   * Whether this caller resolved a promotion at all — *not* whether one
   * applied. See the one-directional rule in {@link stillQuotesCurrentCharge}.
   */
  promoResolved: boolean;
};

/**
 * Whether a stored pending session still quotes what the diver would be charged
 * now (PAY-L2).
 *
 * A `booking_checkouts` row is evidence of what the diver was asked for at the
 * moment it was minted, and Stripe holds those amounts for the whole life of
 * the hosted session — completing it a week later charges the old figure, not
 * today's. So every input that moves the figure is compared:
 *
 * - `amountPerDiverCents` and `isDeposit` — one `checkoutCharge` answer, two
 *   columns. They move separately: a trip repriced from $180 to $210 changes the
 *   first, and a deposit policy arriving on a $180 trip changes both *and* the
 *   meaning of the charge (part now, balance later), which the hosted page says
 *   out loud.
 * - `totalCents` — party size and this diver's priced gear, which the trip fee
 *   alone cannot see.
 * - `currency` — 18000 of one currency's minor unit is not 18000 of another's
 *   (docs ADR 20260731-shop-currency).
 *
 * **The promotion comparison is deliberately one-directional.** A caller that
 * resolved a code (`promotionCode` present) is compared strictly: a session
 * minted at a different percent, or at none, no longer matches. A caller that
 * resolved *nothing* is not evidence the discount went away — `payForBooking`
 * and the ready page's Pay button (`src/app/s/[shopSlug]/trips/[id]/actions.ts`,
 * `src/app/ready/[token]/actions.ts`) never resolve a code at all, because a
 * diver returning to a session they already hold has typed nothing new. Treating
 * that silence as "the promo is gone" would retire every discounted session on
 * the diver's way back to it and re-mint at full price, which is this ticket's
 * own harm pointed the other way. Whether a code is still *live* is Stripe's
 * question, not ours: the discount is attached to the session it already
 * created, and this layer never re-litigates it.
 */
function stillQuotesCurrentCharge(existing: BookingCheckout, current: CurrentCharge): boolean {
  if (!quotesCurrentTripCharge(existing, current)) return false;
  if (existing.totalCents !== current.totalCents) return false;
  if (!current.promoResolved) return true;
  return existing.appliedDiscountPercent === current.appliedDiscountPercent;
}

/**
 * The part of {@link stillQuotesCurrentCharge} that depends on nothing but the
 * trip and the shop — so it can also be answered for a lone stored row, with no
 * caller-supplied party, gear, or code to compare against (see
 * {@link retirePendingCheckoutIfRepriced}).
 */
function quotesCurrentTripCharge(
  existing: BookingCheckout,
  current: Pick<CurrentCharge, "amountPerDiverCents" | "isDeposit" | "currency">,
): boolean {
  return (
    existing.amountPerDiverCents === current.amountPerDiverCents &&
    existing.isDeposit === current.isDeposit &&
    existing.currency === current.currency
  );
}

/**
 * The same staleness rule (PAY-L2) applied to the *other* way a pending session
 * is handed back: the confirmation panel's "Finish paying", which links
 * `booking_checkouts.checkout_url` straight to Stripe rather than going through
 * `startBookingCheckout` (`src/app/s/[shopSlug]/trips/[id]/page.tsx`). Fixing
 * only the reuse branch above would leave the most-travelled path still handing
 * over the old figure.
 *
 * Compares only what a lone row can be compared on — the trip's own charge and
 * the shop's currency. The party is whatever this row already covers, the gear
 * is this diver's own recorded selection, and the panel resolves no promotion
 * code, so none of those three is a change anyone made.
 *
 * Returns the row to keep using, or the retired one. Retired is not a dead end
 * for the diver: with no live pending checkout the panel falls through to its
 * "Pay now" form, which mints a fresh session at today's price through
 * `startBookingCheckout` — so the figure they see on Stripe's hosted page is
 * the one the shop is actually asking for.
 */
export async function retirePendingCheckoutIfRepriced(
  db: AppDb,
  shopId: string,
  existing: BookingCheckout,
): Promise<BookingCheckout> {
  if (existing.status !== "pending") return existing;

  const [tripRow] = await db
    .select({ trip: trips, course: courses })
    .from(trips)
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .where(and(eq(trips.id, existing.tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  // No trip, or a trip that no longer prices at all: nothing to compare
  // against, and inventing a mismatch out of missing data would retire a
  // perfectly good session. Leave it exactly as it is.
  if (!tripRow) return existing;
  const charge = checkoutCharge(tripRow.trip, tripRow.course);
  if (charge === null) return existing;

  const currency = await getShopCurrency(db, shopId);
  if (
    quotesCurrentTripCharge(existing, {
      amountPerDiverCents: charge.amountCents,
      isDeposit: charge.isDeposit,
      currency,
    })
  ) {
    return existing;
  }
  await retireStaleCheckout(db, existing);
  return { ...existing, status: "expired" };
}

/**
 * Retire a pending session whose figure no longer matches, so nothing can hand
 * it back and no later completion can attribute its stale price to these seats.
 *
 * `pending → expired` is the existing terminal for "this local checkout is no
 * longer payable" — the same one `rescheduleBooking` and
 * `markCheckoutPaymentFailedBySessionId` write. Scoped to `pending` so a
 * completion that landed between the read above and this write is never
 * demoted: money that already moved outranks a stale quote.
 *
 * Deliberately touches no `booking_payments` row and no booking. The seats were
 * committed before checkout ever ran (docs ADR 20260721-checkout-at-booking) and
 * this is a quote being withdrawn, not a payment being reversed.
 */
async function retireStaleCheckout(db: AppDb, existing: BookingCheckout): Promise<void> {
  await db
    .update(bookingCheckouts)
    .set({ status: "expired" })
    .where(and(eq(bookingCheckouts.id, existing.id), eq(bookingCheckouts.status, "pending")));
  log("checkout.retired_stale_quote", "info", {
    shopId: existing.shopId,
    checkoutId: existing.id,
    stripeSessionId: existing.stripeSessionId,
    quotedTotalCents: existing.totalCents,
  });
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
  shopId: string,
  checkoutId: string,
  bookingIds: string[],
): Promise<boolean> {
  const linked = await db
    .select({ bookingId: bookingCheckoutBookings.bookingId })
    .from(bookingCheckoutBookings)
    // Shop-scoped like every other read in this file. The checkout was resolved
    // under the shop scope and its links are same-shop by construction, so no
    // result moves — the predicate is here so the rule holds by inspection.
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        eq(bookingCheckoutBookings.checkoutId, checkoutId),
      ),
    );
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
 * `applied_discount_percent` is the whole answer whenever it is set: the
 * percent Stripe was actually told to take off *this* session, snapshotted at
 * session-creation time from whichever promotion the caller applied. Both
 * flavors are percent-only and neither restricts the coupon to particular line
 * items, so one percent describes the whole discount, gear included.
 *
 * Rows written before that column existed have no snapshot. They keep the
 * conservative behaviour they were completed under: a shop-wide code is still
 * reconstructible from its own row (`shop_promo_codes.discount_percent` is NOT
 * NULL and constrained to 1..100), and anything else — an undiscounted session,
 * or an old trip-scoped last-minute deal, which left no local trace at all —
 * falls back to the asked total. Both answers are a figure, never a refusal and
 * never zero.
 *
 * Deliberately never re-derived from whatever deal happens to be live on the
 * trip: that would discount full-price divers on a promoted trip and
 * under-refund people who owe nothing. This checkout's own snapshot, or nothing.
 *
 * Reads only rows, never Stripe: this runs inside the completion transaction.
 */
async function attributableTotalCents(db: DbExecutor, checkout: BookingCheckout): Promise<number> {
  if (checkout.appliedDiscountPercent !== null) {
    return netOfPercentDiscount(checkout.totalCents, checkout.appliedDiscountPercent);
  }
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
        tripCents: bookingCheckoutBookings.tripCents,
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
    const askedCentsFor = (tripCents: number | null, gearCents: number) =>
      (tripCents ?? checkout.amountPerDiverCents) + gearCents;
    // The one figure every per-booking amount is derived from. Stripe's own
    // settled total whenever there is one; otherwise the most this session can
    // have captured, worked out locally (PAY-M3, `attributableTotalCents`).
    // Always a number, so a completion is never refused and never recorded as
    // zero for want of a settled figure.
    const attributableCents =
      updated.settledTotalCents ?? (await attributableTotalCents(tx, updated));
    const allocation = allocateSettledTotal(
      linked.map((row) => ({
        key: row.bookingId,
        askedCents: askedCentsFor(row.tripCents, row.gearCents),
      })),
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
        // to the sum of the asks returns each ask unchanged); with a discount
        // it is their share of what the session can actually have captured,
        // which is what a later refund may reverse.
        //
        // Every discount flavor is now covered on the no-`amount_total` branch:
        // a shop-wide code and a trip-scoped last-minute deal both snapshot the
        // percent they applied onto the checkout row at session-creation time
        // (`applied_discount_percent`), so neither can be mistaken for an
        // undiscounted session. The one remaining class is a row written before
        // that column existed and completed only now — no snapshot exists to
        // read, so it keeps the conservative pre-column answer rather than a
        // guessed one; see `attributableTotalCents`.
        amountCents:
          allocation.get(bookingId) ??
          askedCentsFor(
            linked.find((row) => row.bookingId === bookingId)?.tripCents ?? null,
            gearCents,
          ),
        currency: checkout.currency,
        provider: "stripe",
        providerRef: checkout.stripeSessionId,
        // What caused the transition, for the append-only money trail. A
        // replayed delivery re-runs this cascade on purpose (self-healing), so
        // the trail only appends when something actually changed — see
        // `setBookingPayment` (ADR 20260803-booking-payment-events).
        operation: "checkout_settled",
      });
    }
    return updated;
  });
}

/**
 * Stripe reported this session's **delayed-notification payment failed**
 * (`checkout.session.async_payment_failed`, PAY-L1). Without this handler the
 * row sat `pending` forever: the session had already emitted
 * `checkout.session.completed` with `payment_status: "unpaid"` (which
 * deliberately settles nothing), the money then never arrived, and no later
 * event ever moved it — a permanent desync that kept offering the diver a dead
 * recovery link and kept the seat reading "awaiting payment" with nothing left
 * to await.
 *
 * Releases the pending state the way a failed payment should: `pending →
 * expired`, the existing terminal for "this local checkout is no longer
 * payable", plus `asyncPaymentFailedAt` recording *why* it is terminal. A
 * bank-debit-style payment that Stripe reports failed cannot be retried on the
 * same session, so the honest local state is the same one a timed-out session
 * gets; the timestamp is what keeps the two causes distinguishable without
 * teaching every consumer of `checkout_status` a new value (ADR
 * 20260803-async-payment-failed).
 *
 * **`booking_payments` is deliberately untouched.** An async payment that
 * never settled wrote no payment row in the first place — `markCheckoutPaid…`
 * is the only writer on this path and it never ran — so there is nothing to
 * release there, and writing `unpaid` would be the one thing that *could*
 * regress a booking a human had since marked paid or waived.
 *
 * Idempotent and state-machine-safe like its siblings, by the same mechanism
 * `markCheckoutExpiredBySessionId` uses: the update matches only a `pending`
 * row of the expected connected account, so a redelivery, a failure arriving
 * after a completion (`completed`), or one arriving after a local
 * disqualification (`expired`) all match nothing and return null. It can never
 * demote a settled checkout.
 */
export async function markCheckoutPaymentFailedBySessionId(
  db: AppDb,
  stripeSessionId: string,
  expectedAccountId?: string,
): Promise<BookingCheckout | null> {
  const [updated] = await db
    .update(bookingCheckouts)
    .set({ status: "expired", asyncPaymentFailedAt: nowDate() })
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
