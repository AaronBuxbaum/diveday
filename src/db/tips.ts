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
  // A no-show never dived — no tip is owed for a crew that didn't take them
  // out. Checked here too, not just at the recap page's canTip gate, so a
  // replayed or hand-crafted request against this endpoint can't tip a
  // no-show either.
  if (!row?.email || row.status === "cancelled" || row.status === "no_show") {
    return { ok: false, reason: "invalid_booking" };
  }
  const customerEmail = row.email;

  const account = await getShopStripeAccount(db, row.shopId);
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;
  // The connected account's own settlement currency, not a hardcoded "usd" —
  // task 60. `MIN_TIP_CENTS`/`MAX_TIP_CENTS` and the cents-based amount math
  // below still assume a two-decimal currency; a zero-decimal account
  // currency (e.g. JPY) is a known gap folded into the broader currency-i18n
  // effort (task 35), not fixed here.
  const currency = (account as NonNullable<typeof account>).defaultCurrency;

  // Locks the always-existing bookings row for the rest of this call — same
  // technique src/db/payments.ts uses for payment writes (a booking's first
  // tip has no tips row yet, and `SELECT ... FOR UPDATE` on a row that
  // doesn't exist takes no lock at all). Without serializing here, two
  // near-simultaneous submits (a double click, two open tabs) can each see
  // no pending tip yet and each mint their own Stripe session; if both are
  // later paid, the diver is charged twice for one tip. The lock is held
  // across the Stripe call below, which is an accepted cost for a
  // low-frequency, non-contentious write like a tip (unlike the
  // higher-volume booking-checkout path, which uses a lock-free claim
  // column instead — see `claimBookingsForCheckout`).
  //
  // Known trade-off (Codex finding): because the whole thing — reuse check,
  // Stripe call, and the payment-operation intent's start/resolve — shares
  // this one transaction, a crash between the Stripe call succeeding and
  // this transaction committing rolls the intent row back along with
  // everything else, leaving no local trail of a session that may exist at
  // Stripe. `startBookingCheckout` avoids this by committing its intent
  // *before* calling Stripe and using a lock-free claim column instead of a
  // held row lock (see `claimBookingsForCheckout`) — reusing that same
  // column for tips was considered and rejected (this session, same ADR)
  // to avoid cross-blocking two independent money flows on one shared
  // per-booking claim slot. Doing this correctly for tips needs the same
  // kind of dedicated claim mechanism, which is a schema change against a
  // money-handling path — out of scope to rush here. The blast radius is
  // bounded: DiveDay never holds the money (docs ADR
  // 20260726-post-trip-tipping), so an orphaned session only means the
  // shop's own Stripe dashboard is the source of truth until someone
  // reconciles it by hand, never a lost or double charge.
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for("update");
    // Re-checked under the lock, not just in the pre-transaction read above:
    // staff can cancel or mark no_show between that read and acquiring this
    // lock, and the stale status from before would otherwise still create a
    // payable Stripe session for a booking that's no longer eligible (Codex
    // finding).
    if (!locked || locked.status === "cancelled" || locked.status === "no_show") {
      return { ok: false, reason: "invalid_booking" };
    }

    const existing = await getLatestTipForBooking(tx, row.shopId, input.bookingId);
    if (
      existing?.status === "pending" &&
      existing.checkoutUrl &&
      (!existing.expiresAt || existing.expiresAt > nowDate())
    ) {
      return { ok: true, checkoutUrl: existing.checkoutUrl };
    }

    const intent = await startPaymentOperation(tx as unknown as AppDb, {
      shopId: row.shopId,
      kind: "checkout_session",
      bookingId: input.bookingId,
    });

    const session = await checkout.createCheckoutSession({
      stripeAccountId,
      currency,
      description: "Tip for the crew",
      unitAmountCents: input.amountCents,
      quantity: 1,
      customerEmail,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      idempotencyKey: idempotencyKeyFor(intent.id),
    });
    if (session.status !== "created") {
      await resolvePaymentOperation(tx as unknown as AppDb, intent.id, {
        status: "failed",
        errorMessage: session.status,
      });
      return { ok: false, reason: "checkout_unavailable" };
    }
    await recordPaymentOperationStripeObject(
      tx as unknown as AppDb,
      intent.id,
      session.stripeSessionId,
    );

    const [created] = await tx
      .insert(tips)
      .values({
        shopId: row.shopId,
        bookingId: input.bookingId,
        stripeAccountId,
        stripeSessionId: session.stripeSessionId,
        checkoutUrl: session.checkoutUrl,
        currency,
        amountCents: input.amountCents,
        expiresAt: session.expiresAt,
      })
      .returning();
    await resolvePaymentOperation(tx as unknown as AppDb, intent.id, { status: "succeeded" });
    if (!created?.checkoutUrl) {
      return { ok: false, reason: "checkout_unavailable" };
    }
    return { ok: true, checkoutUrl: created.checkoutUrl };
  });
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

/**
 * Ask Stripe directly whether a still-`pending` tip actually settled or
 * expired — the webhook-less fallback the booking-checkout confirmation
 * page already leans on (`refreshCheckoutFromStripe`), for the same reason:
 * a delayed/missed webhook must never leave the recap page showing a dead
 * Checkout link forever, or (worse) a `?tip=paid` return-URL trusted as
 * proof of payment on its own. A non-pending tip, or a Stripe lookup that
 * itself fails, is returned unchanged — the caller only cares whether the
 * *local* row moved.
 */
export async function refreshTipFromStripe(
  db: AppDb,
  shopId: string,
  tipId: string,
  checkout: CheckoutProvider = checkoutProviderFromEnvironment(),
): Promise<Tip | null> {
  const [row] = await db
    .select()
    .from(tips)
    .where(and(eq(tips.id, tipId), eq(tips.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  if (row.status !== "pending") return row;

  const result = await checkout.retrieveCheckoutSession(row.stripeAccountId, row.stripeSessionId);
  if (result.status !== "ok") return row;
  if (result.session.paymentStatus === "paid") {
    return markTipPaidBySessionId(db, row.stripeSessionId);
  }
  if (result.session.stripeStatus === "expired") {
    return markTipExpiredBySessionId(db, row.stripeSessionId);
  }
  return row;
}
