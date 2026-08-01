import { and, desc, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { majorToMinor, type ShopCurrency, toShopCurrency } from "@/lib/money";
import {
  type CheckoutProvider,
  checkoutProviderFromEnvironment,
  stripeLineDescription,
} from "@/lib/payments/checkout";
import type { AppDb, DbExecutor } from "./client";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { bookings, people, shops, type Tip, tips } from "./schema";
import { canAcceptPayments, getShopCurrency, getShopStripeAccount } from "./stripe-accounts";

export type StartTipInput = {
  bookingId: string;
  /** An integer count of the shop currency's minor unit — see `tipBoundsCents`. */
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  /**
   * The words for the single line on the hosted Stripe page, composed by the
   * caller from the diver's message bundle — this layer returns codes, not
   * sentences (docs ADR 20260731-domain-layer-copy-leaks). Unlike a booking
   * checkout there is no branch to describe, so a finished string is the
   * simplest honest shape.
   */
  lineDescription: string;
};

export type StartTipOutcome =
  | { ok: true; checkoutUrl: string }
  | {
      ok: false;
      reason: "not_connected" | "invalid_amount" | "invalid_booking" | "checkout_unavailable";
    };

/**
 * The tip range in *major* units of a US-dollar-sized currency: generous enough
 * for a real gratitude tip, bounded against a mistyped or abusive amount.
 * `tipBoundsCents` turns these into the shop currency's own minor units.
 */
export const MIN_TIP_MAJOR = 1;
export const MAX_TIP_MAJOR = 500;

/**
 * Roughly how many major units of a currency stand in for one US dollar,
 * rounded hard to an order of magnitude.
 *
 * **This is not an exchange rate and must never be used as one.** Nothing
 * charged, quoted, stored, or displayed is computed from it. Its only job is
 * to keep the tip sanity bounds meaningful in currencies whose major unit is
 * far smaller than a dollar: a flat 1–500 major-unit range would make the
 * smallest legal tip in Indonesia Rp 1 (a fraction of a cent) and the largest
 * Rp 500 (about three cents), refusing every real tip a diver would leave.
 * Being 30% stale changes nothing about a bound whose whole purpose is to
 * catch a typo two orders of magnitude out; a real FX source would be the
 * wrong dependency to take on for it.
 *
 * Currencies within ~2x of the dollar (usd, eur, gbp, cad, aud, nzd, sgd, chf)
 * are deliberately absent and take the default of 1.
 */
const APPROX_MAJOR_UNITS_PER_USD: Partial<Record<ShopCurrency, number>> = {
  brl: 5,
  dkk: 7,
  egp: 50,
  idr: 16_000,
  ils: 4,
  jpy: 150,
  mxn: 20,
  myr: 5,
  nok: 10,
  php: 55,
  sek: 10,
  thb: 35,
  zar: 18,
};

/**
 * The tip range in this currency's own minor units. Two conversions, both from
 * `src/lib/money.ts` and neither a literal 100: the coarse scale above puts the
 * bound at a comparable *value*, and `majorToMinor` puts it in the unit the
 * column and Stripe both use — so a zero-decimal currency is never divided or
 * multiplied by a hundred it doesn't have (docs ADR 20260731-shop-currency).
 */
export function tipBoundsCents(currency: string): { minCents: number; maxCents: number } {
  const scale = APPROX_MAJOR_UNITS_PER_USD[toShopCurrency(currency)] ?? 1;
  return {
    minCents: majorToMinor(MIN_TIP_MAJOR * scale, currency),
    maxCents: majorToMinor(MAX_TIP_MAJOR * scale, currency),
  };
}

/** The suggested tip buttons, in a US-dollar-sized currency's major units. */
const TIP_PRESETS_MAJOR = [5, 10, 20];

/**
 * The recap page's suggested tip amounts, in this currency's major units.
 *
 * Shares `APPROX_MAJOR_UNITS_PER_USD` with `tipBoundsCents` on purpose, and
 * that is the whole point of it living here rather than in the page: a flat
 * `[5, 10, 20]` sits *below* the scaled minimum in thirteen of the twenty-one
 * supported currencies, so an Indonesian shop's diver was shown three tip
 * buttons and every one of them bounced with a range error
 * (security-reviewer finding). Presets and bounds now cannot drift apart.
 */
export function tipPresetsMajor(currency: string): number[] {
  const scale = APPROX_MAJOR_UNITS_PER_USD[toShopCurrency(currency)] ?? 1;
  return TIP_PRESETS_MAJOR.map((amount) => amount * scale);
}

/**
 * The currency a tip for this booking will be charged in — the *shop's*
 * currency, resolved through the booking exactly the way `startTipCheckout`
 * resolves it, so the recap action can bound and convert the diver's typed
 * amount against the same value this function will re-check it against. Null
 * when the booking doesn't exist.
 *
 * Exported because the recap action must turn a typed major-unit amount into
 * minor units before it has anything else to go on, and the currency is the
 * only thing that decides how (docs ADR 20260731-shop-currency). Never take
 * this from a form field: it decides what a diver is charged.
 */
export async function getTipCurrencyForBooking(
  db: DbExecutor,
  bookingId: string,
): Promise<ShopCurrency | null> {
  const [row] = await db
    .select({ currency: shops.currency })
    .from(bookings)
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return row ? toShopCurrency(row.currency) : null;
}

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
  // The shop's own declared currency, not the connected account's
  // `default_currency` (which task 60 read here) and not a hardcoded "usd":
  // one source of truth for every amount this shop charges, so a tip is
  // quoted in the same currency as the trip the diver just paid for
  // (docs ADR 20260731-shop-currency). The account's reported currency stays
  // advisory and surfaces as a settings warning (`stripeCurrencyMismatch`).
  const currency = await getShopCurrency(db, row.shopId);
  // Bounds in this currency's own minor units — the zero-decimal gap task 60
  // deferred to task 35 is closed here: nothing on this path multiplies or
  // divides by a literal 100, so a ¥ tip is bounded in whole yen and a $ tip
  // in cents, both meaning roughly the same amount of money.
  const { minCents, maxCents } = tipBoundsCents(currency);
  if (
    !Number.isInteger(input.amountCents) ||
    input.amountCents < minCents ||
    input.amountCents > maxCents
  ) {
    return { ok: false, reason: "invalid_amount" };
  }

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
      lineItems: [
        {
          description: stripeLineDescription(input.lineDescription),
          unitAmountCents: input.amountCents,
          quantity: 1,
        },
      ],
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
