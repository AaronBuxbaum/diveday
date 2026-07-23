import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { checkoutCharge } from "@/lib/deposits";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import type { AppDb, DbExecutor } from "./client";
import {
  claimBookingsForCheckout,
  idempotencyKeyFor,
  releaseBookingCheckoutClaim,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { setBookingPaymentIfNotFinal } from "./payments";
import type { BookingCheckout } from "./schema";
import { bookingCheckoutBookings, bookingCheckouts, bookings, courses, trips } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";

export type StartCheckoutInput = {
  shopId: string;
  tripId: string;
  bookingIds: string[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
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
      currency: "usd",
      // A deposit is labelled as one on the hosted page so the diver knows a
      // balance is still due, not that this is the whole fare.
      description: charge.isDeposit ? `Deposit — ${tripRow.trip.title}` : tripRow.trip.title,
      unitAmountCents: amountPerDiverCents,
      quantity: input.bookingIds.length,
      customerEmail: input.customerEmail,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
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

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(bookingCheckouts)
        .values({
          shopId: input.shopId,
          tripId: input.tripId,
          stripeAccountId,
          stripeSessionId: session.stripeSessionId,
          checkoutUrl: session.checkoutUrl,
          currency: "usd",
          amountPerDiverCents,
          totalCents: amountPerDiverCents * input.bookingIds.length,
          isDeposit: charge.isDeposit,
          expiresAt: session.expiresAt,
        })
        .returning();
      if (!row) throw new Error("startBookingCheckout: insert returned no row");
      await tx.insert(bookingCheckoutBookings).values(
        input.bookingIds.map((bookingId) => ({
          shopId: input.shopId,
          checkoutId: row.id,
          bookingId,
        })),
      );
      return row;
    });
    await resolvePaymentOperation(db, intent.id, {
      status: "succeeded",
      stripeObjectId: session.stripeSessionId,
    });

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
): Promise<BookingCheckout | null> {
  return db.transaction(async (tx) => {
    const [checkout] = await tx
      .select()
      .from(bookingCheckouts)
      .where(eq(bookingCheckouts.stripeSessionId, stripeSessionId))
      .limit(1);
    if (!checkout) return null;

    const updated =
      checkout.status === "completed"
        ? checkout
        : ((
            await tx
              .update(bookingCheckouts)
              .set({ status: "completed", completedAt: nowDate() })
              .where(eq(bookingCheckouts.id, checkout.id))
              .returning()
          )[0] ?? null);
    if (!updated) return null;

    const linked = await tx
      .select({ bookingId: bookingCheckoutBookings.bookingId })
      .from(bookingCheckoutBookings)
      .where(eq(bookingCheckoutBookings.checkoutId, checkout.id));
    for (const { bookingId } of linked) {
      await setBookingPaymentIfNotFinal(tx, {
        shopId: checkout.shopId,
        bookingId,
        // A deposit checkout clears the readiness gate as deposit_paid; the
        // balance is collected later (staff order or a full checkout).
        status: checkout.isDeposit ? "deposit_paid" : "paid",
        amountCents: checkout.amountPerDiverCents,
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
): Promise<BookingCheckout | null> {
  const [updated] = await db
    .update(bookingCheckouts)
    .set({ status: "expired" })
    .where(
      and(
        eq(bookingCheckouts.stripeSessionId, stripeSessionId),
        eq(bookingCheckouts.status, "pending"),
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
    return markCheckoutPaidBySessionId(db, row.stripeSessionId);
  }
  if (result.session.stripeStatus === "expired") {
    return markCheckoutExpiredBySessionId(db, row.stripeSessionId);
  }
  return row;
}
