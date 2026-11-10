import { and, eq, gt, inArray, isNotNull, isNull, like, lt, or, type SQL } from "drizzle-orm";
import { PAYMENT_CLAIM_STALE_AFTER_MS } from "@/lib/attempts";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import type { PaymentOperationIntent, PaymentOperationKind } from "./schema";
import { bookings, paymentOperationIntents } from "./schema";
import { seatHeld } from "./trips-queries";

export type StartPaymentOperationInput = {
  shopId: string;
  kind: PaymentOperationKind;
  tripId?: string;
  bookingId?: string;
  orderId?: string;
  checkoutId?: string;
};

/**
 * Write the durable "about to call Stripe" record and commit it on its own —
 * deliberately not inside the transaction that will later hold the local
 * order/checkout row, because that transaction can't exist yet (nothing local
 * is known until Stripe responds) and a row that only commits alongside a
 * later write is not durable against a crash between the two (CR-005).
 */
export async function startPaymentOperation(
  db: DbExecutor,
  input: StartPaymentOperationInput,
): Promise<PaymentOperationIntent> {
  const [intent] = await db
    .insert(paymentOperationIntents)
    .values({
      shopId: input.shopId,
      kind: input.kind,
      tripId: input.tripId ?? null,
      bookingId: input.bookingId ?? null,
      orderId: input.orderId ?? null,
      checkoutId: input.checkoutId ?? null,
    })
    .returning();
  if (!intent) throw new Error("startPaymentOperation: insert returned no row");
  return intent;
}

/**
 * Durably record the Stripe object id the moment Stripe confirms it exists —
 * its own committed write, deliberately *before* the local order/checkout/
 * payment write that follows. That local write can still fail (a crash, a
 * dropped connection); if it does, the intent is left `started` but with
 * `stripeObjectId` already on it, so the stuck-payment read (`src/db/unfinished.ts`) gives an
 * operator the one thing they need to find the object in the Stripe
 * dashboard and reconcile it by hand — the reconciliation clue a crash right
 * after this point would otherwise have taken with it (CR-005).
 */
export async function recordPaymentOperationStripeObject(
  db: DbExecutor,
  intentId: string,
  stripeObjectId: string,
): Promise<void> {
  await db
    .update(paymentOperationIntents)
    .set({ stripeObjectId })
    .where(eq(paymentOperationIntents.id, intentId));
}

/**
 * The mark an intent carries when its Stripe call went out and no answer came
 * back: a timeout, a reset connection, a body that never arrived. Stripe may
 * have done the thing, so the intent is **not** resolved `failed`: it stays
 * `started` with this as its `errorMessage`, which the stuck-payment read (`src/db/unfinished.ts`)
 * shows a human once it ages, and which every refund claim refuses on
 * ({@link awaitingStripeReconciliation}). Resolving it `failed` was what let a
 * second Refund press mint a fresh idempotency key and reverse the money a
 * second time (fifth review, row 17).
 */
export const UNANSWERED_BY_STRIPE = "unanswered";

/** Leave the intent `started`, marked {@link UNANSWERED_BY_STRIPE}. */
export async function markPaymentOperationUnanswered(
  db: DbExecutor,
  intentId: string,
): Promise<void> {
  await db
    .update(paymentOperationIntents)
    .set({ errorMessage: UNANSWERED_BY_STRIPE })
    .where(eq(paymentOperationIntents.id, intentId));
}

/**
 * The `started` intents a refund claim must refuse on rather than retry past,
 * stale or not: one Stripe confirmed (`stripeObjectId` written) and one Stripe
 * never answered. Either may be money that already moved, and a new attempt is
 * a new idempotency key Stripe would honour. Combine with the claim's own
 * `status = 'started'` and scope conditions.
 */
export function awaitingStripeReconciliation(): SQL {
  return or(
    isNotNull(paymentOperationIntents.stripeObjectId),
    eq(paymentOperationIntents.errorMessage, UNANSWERED_BY_STRIPE),
  ) as SQL;
}

/**
 * A dashboard refund on a party checkout that no seat carries yet
 * (`parkStripeReversal` in `src/db/refunds.ts`, issue #2293): a `started`
 * refund intent on a checkout, parked with the `unattributed_refund` note and
 * the amount still to match. Status is the caller's to add.
 */
export function heldUnattributedRefund(): SQL {
  return and(
    eq(paymentOperationIntents.kind, "refund"),
    isNotNull(paymentOperationIntents.checkoutId),
    isNotNull(paymentOperationIntents.amountCents),
    like(paymentOperationIntents.errorMessage, "unattributed\\_refund:%"),
  ) as SQL;
}

export type ResolvePaymentOperationInput = {
  status: "succeeded" | "failed";
  stripeObjectId?: string;
  errorMessage?: string;
};

/**
 * Record how the Stripe call this intent describes actually resolved. On
 * success this is the *second* write for a call that got a Stripe object —
 * `recordPaymentOperationStripeObject` already made the id durable before
 * the risky local write ran; this just closes the intent out once that
 * local write also succeeded.
 */
export async function resolvePaymentOperation(
  db: DbExecutor,
  intentId: string,
  input: ResolvePaymentOperationInput,
): Promise<void> {
  await db
    .update(paymentOperationIntents)
    .set({
      status: input.status,
      ...(input.stripeObjectId ? { stripeObjectId: input.stripeObjectId } : {}),
      errorMessage: input.errorMessage ?? null,
      resolvedAt: nowDate(),
    })
    .where(eq(paymentOperationIntents.id, intentId));
}

/**
 * Deterministic Stripe `Idempotency-Key` material for one intent, optionally
 * scoped to one step of a multi-request operation (invoice creation is
 * customer → invoiceitem(s) → invoice → finalize, each its own POST). Reusing
 * the intent's own id means a retry of the same logical attempt — a lost
 * response, a redeployed process picking up where a crashed one left off —
 * always resolves to the same Stripe idempotency key, so Stripe itself
 * collapses the retry onto the original object instead of creating a second
 * one (CR-005).
 */
export function idempotencyKeyFor(intentId: string, step?: string): string {
  return step ? `${intentId}:${step}` : intentId;
}

/**
 * Atomically claim a set of bookings for one in-flight checkout attempt, so a
 * second concurrent `startBookingCheckout` call for an overlapping party can
 * never also proceed to Stripe — closing the "concurrent starts create
 * multiple payable sessions" race CR-005 targets. Each `UPDATE ... WHERE
 * pending_checkout_intent_id IS NULL` is atomic per row under Postgres's
 * standard row-locking: two racing claims on the same booking serialize, and
 * the loser's WHERE clause re-evaluates against the winner's committed
 * write and finds the row no longer eligible.
 *
 * A booking claimed by an intent that started long enough ago to be
 * considered abandoned (a crashed process that never resolved it) is
 * self-healingly freed first — a claim is a short-lived guard for the
 * duration of one Stripe round trip, never a permanent lock a dead process
 * can leave stuck on a seat forever.
 *
 * Returns false (claiming nothing) if any requested booking is genuinely
 * held by another live attempt; the caller should not proceed to Stripe.
 */
export async function claimBookingsForCheckout(
  db: AppDb,
  input: { bookingIds: string[]; intentId: string; staleBefore?: Date },
): Promise<boolean> {
  const staleBefore =
    input.staleBefore ?? new Date(nowDate().getTime() - PAYMENT_CLAIM_STALE_AFTER_MS);
  return db.transaction(async (tx) => {
    const staleIntents = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(
        and(
          eq(paymentOperationIntents.kind, "checkout_session"),
          eq(paymentOperationIntents.status, "started"),
          lt(paymentOperationIntents.startedAt, staleBefore),
        ),
      );
    if (staleIntents.length > 0) {
      await tx
        .update(bookings)
        .set({ pendingCheckoutIntentId: null })
        .where(
          and(
            inArray(bookings.id, input.bookingIds),
            inArray(
              bookings.pendingCheckoutIntentId,
              staleIntents.map((row) => row.id),
            ),
          ),
        );
    }

    const claimed = await tx
      .update(bookings)
      .set({ pendingCheckoutIntentId: input.intentId })
      .where(
        and(
          inArray(bookings.id, input.bookingIds),
          seatHeld,
          isNull(bookings.pendingCheckoutIntentId),
          or(isNull(bookings.groupHoldUntil), gt(bookings.groupHoldUntil, nowDate())),
        ),
      )
      .returning({ id: bookings.id });

    if (claimed.length !== input.bookingIds.length) {
      // Partial claim: give back what we just took so a failed attempt never
      // leaves a booking blocked on its own losing claim.
      if (claimed.length > 0) {
        await tx
          .update(bookings)
          .set({ pendingCheckoutIntentId: null })
          .where(
            and(
              inArray(
                bookings.id,
                claimed.map((row) => row.id),
              ),
              eq(bookings.pendingCheckoutIntentId, input.intentId),
            ),
          );
      }
      return false;
    }
    return true;
  });
}

/** Release the claim once the attempt has resolved, win or lose. */
export async function releaseBookingCheckoutClaim(
  db: DbExecutor,
  bookingIds: string[],
  intentId: string,
): Promise<void> {
  if (bookingIds.length === 0) return;
  await db
    .update(bookings)
    .set({ pendingCheckoutIntentId: null })
    .where(and(inArray(bookings.id, bookingIds), eq(bookings.pendingCheckoutIntentId, intentId)));
}
