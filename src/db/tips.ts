import { and, desc, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type CheckoutProvider, checkoutProviderFromEnvironment } from "@/lib/payments/checkout";
import type { AppDb, DbExecutor } from "./client";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { bookings, people, type Tip, tips } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";

export type StartTipInput = {
  bookingId: string;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
};

export type StartTipOutcome =
  | { ok: true; checkoutUrl: string }
  | {
      ok: false;
      reason: "not_connected" | "invalid_amount" | "invalid_booking" | "checkout_unavailable";
    };

/** $1–$500, generous enough for a real gratitude tip, bounded against a mistyped/abusive amount. */
export const MIN_TIP_CENTS = 100;
export const MAX_TIP_CENTS = 50_000;

/**
 * Hand the diver a hosted Stripe Checkout for a post-trip tip on the shop's
 * connected account — the same merchant-of-record model bookings use, a full
 * 100% to the shop (no platform fee, no crew-level split; docs ADR
 * 20260726-post-trip-tipping). A separate table/flow from `startBookingCheckout`
 * on purpose: a tip never touches the booking-payment gate.
 *
 * `shopId` is deliberately not a caller-supplied input — the recap flow's
 * only credential is a signed token that resolves to a `bookingId`
 * (`verifyRecapToken`), so shop identity is derived from that booking here,
 * the same "never trust a client-supplied tenant id" rule the booking
 * capability system already follows.
 */
export async function startTipCheckout(
  db: AppDb,
  input: StartTipInput,
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<StartTipOutcome> {
  if (input.amountCents < MIN_TIP_CENTS || input.amountCents > MAX_TIP_CENTS) {
    return { ok: false, reason: "invalid_amount" };
  }

  const [row] = await db
    .select({ shopId: bookings.shopId, email: people.email, status: bookings.status })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(eq(bookings.id, input.bookingId))
    .limit(1);
  if (!row?.email || row.status === "cancelled") return { ok: false, reason: "invalid_booking" };

  const account = await getShopStripeAccount(db, row.shopId);
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const intent = await startPaymentOperation(db, {
    shopId: row.shopId,
    kind: "checkout_session",
    bookingId: input.bookingId,
  });

  const session = await checkout.createCheckoutSession({
    stripeAccountId,
    currency: "usd",
    description: "Tip for the crew",
    unitAmountCents: input.amountCents,
    quantity: 1,
    customerEmail: row.email,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    idempotencyKey: idempotencyKeyFor(intent.id),
  });
  if (session.status !== "created") {
    await resolvePaymentOperation(db, intent.id, {
      status: "failed",
      errorMessage: session.status,
    });
    return { ok: false, reason: "checkout_unavailable" };
  }
  await recordPaymentOperationStripeObject(db, intent.id, session.stripeSessionId);

  const [created] = await db
    .insert(tips)
    .values({
      shopId: row.shopId,
      bookingId: input.bookingId,
      stripeAccountId,
      stripeSessionId: session.stripeSessionId,
      checkoutUrl: session.checkoutUrl,
      currency: "usd",
      amountCents: input.amountCents,
      expiresAt: session.expiresAt,
    })
    .returning();
  await resolvePaymentOperation(db, intent.id, { status: "succeeded" });
  if (!created?.checkoutUrl) {
    return { ok: false, reason: "checkout_unavailable" };
  }
  return { ok: true, checkoutUrl: created.checkoutUrl };
}

/** The most recent tip for this booking, or null — drives the recap page's tip panel. */
export async function getLatestTipForBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<Tip | null> {
  const [row] = await db
    .select()
    .from(tips)
    .where(and(eq(tips.shopId, shopId), eq(tips.bookingId, bookingId)))
    .orderBy(desc(tips.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Mark a tip paid from Stripe's own webhook evidence. Idempotent: an
 * already-paid tip is returned unchanged rather than re-stamping
 * `completedAt`. Deliberately does nothing else — no booking-payment
 * cascade, unlike `markCheckoutPaidBySessionId` — a tip never touches that
 * gate.
 */
export async function markTipPaidBySessionId(
  db: AppDb,
  stripeSessionId: string,
): Promise<Tip | null> {
  const [tip] = await db
    .select()
    .from(tips)
    .where(eq(tips.stripeSessionId, stripeSessionId))
    .limit(1);
  if (!tip) return null;
  if (tip.status === "paid") return tip;
  const [updated] = await db
    .update(tips)
    .set({ status: "paid", completedAt: nowDate() })
    .where(eq(tips.id, tip.id))
    .returning();
  return updated ?? null;
}

/** A Stripe-expired session can no longer be paid; pending → expired. */
export async function markTipExpiredBySessionId(
  db: AppDb,
  stripeSessionId: string,
): Promise<Tip | null> {
  const [updated] = await db
    .update(tips)
    .set({ status: "expired" })
    .where(and(eq(tips.stripeSessionId, stripeSessionId), eq(tips.status, "pending")))
    .returning();
  return updated ?? null;
}
