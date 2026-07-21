import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import type { AppDb, DbExecutor } from "./client";
import { setBookingPayment } from "./payments";
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
  const amountPerDiverCents = perDiverBookingPriceCents(tripRow.trip, tripRow.course);
  if (amountPerDiverCents === null || amountPerDiverCents <= 0) {
    return { ok: false, reason: "unpriced" };
  }

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
    (!existing.expiresAt || existing.expiresAt > new Date())
  ) {
    return { ok: true, checkout: existing, reused: true };
  }

  const session = await checkout.createCheckoutSession({
    stripeAccountId,
    currency: "usd",
    description: tripRow.trip.title,
    unitAmountCents: amountPerDiverCents,
    quantity: input.bookingIds.length,
    customerEmail: input.customerEmail,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
  if (session.status !== "created") return { ok: false, reason: "checkout_unavailable" };

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

  return { ok: true, checkout: created, reused: false };
}

/** The most recent checkout linked to any of these bookings. */
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
 * booking through the shared payment gate. Idempotent: a second webhook or a
 * webhook racing the return-page refresh finds `completed` and does nothing.
 */
export async function markCheckoutPaidBySessionId(
  db: AppDb,
  stripeSessionId: string,
): Promise<BookingCheckout | null> {
  const [checkout] = await db
    .select()
    .from(bookingCheckouts)
    .where(eq(bookingCheckouts.stripeSessionId, stripeSessionId))
    .limit(1);
  if (!checkout) return null;
  if (checkout.status === "completed") return checkout;

  const [updated] = await db
    .update(bookingCheckouts)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(bookingCheckouts.id, checkout.id))
    .returning();
  if (!updated) return null;

  const linked = await db
    .select({ bookingId: bookingCheckoutBookings.bookingId })
    .from(bookingCheckoutBookings)
    .where(eq(bookingCheckoutBookings.checkoutId, checkout.id));
  for (const { bookingId } of linked) {
    await setBookingPayment(db, {
      shopId: checkout.shopId,
      bookingId,
      status: "paid",
      amountCents: checkout.amountPerDiverCents,
      currency: checkout.currency,
      provider: "stripe",
      providerRef: checkout.stripeSessionId,
    });
  }
  return updated;
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
