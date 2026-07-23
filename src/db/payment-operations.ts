import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import type { PaymentOperationIntent, PaymentOperationKind } from "./schema";
import {
  bookingCheckouts,
  bookings,
  orders,
  paymentOperationIntents,
  people,
  trips,
} from "./schema";

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
  db: AppDb,
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
 * `stripeObjectId` already on it, so `listStuckPaymentOperations` gives an
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

const STALE_AFTER_MS = 5 * 60 * 1000;

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
  const staleBefore = input.staleBefore ?? new Date(nowDate().getTime() - STALE_AFTER_MS);
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
      .where(and(inArray(bookings.id, input.bookingIds), isNull(bookings.pendingCheckoutIntentId)))
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

export type StuckPaymentOperation = {
  intent: PaymentOperationIntent;
  tripId: string | null;
  tripTitle: string | null;
  personName: string | null;
};

/**
 * Intents still `started` well past the time a Stripe round trip should take
 * — the process died mid-call, or died between the call succeeding and the
 * local order/checkout/payment write that should have followed. These are
 * exactly the "orphaned or indeterminate" operations CR-005 requires be
 * owner-visible rather than silently stuck forever; staff check the intent's
 * `stripeObjectId` (if any) against the Stripe dashboard and reconcile by
 * hand. `olderThan` is injectable for tests; defaults to the real clock.
 */
export async function listStuckPaymentOperations(
  db: AppDb,
  shopId: string,
  olderThan: Date = new Date(nowDate().getTime() - STALE_AFTER_MS),
): Promise<StuckPaymentOperation[]> {
  const intents = await db
    .select()
    .from(paymentOperationIntents)
    .where(
      and(
        eq(paymentOperationIntents.shopId, shopId),
        eq(paymentOperationIntents.status, "started"),
        lt(paymentOperationIntents.startedAt, olderThan),
      ),
    );
  if (intents.length === 0) return [];

  // Batched lookups, not a join: a checkout_session intent's trip, a
  // bookingId intent's booking->trip/person, and an invoice/refund intent's
  // order->person live on different tables, and only one of these
  // references is ever set per intent (schema.ts comment). Every lookup is
  // scoped to shopId too — belt-and-suspenders alongside every caller
  // already validating a referenced row's shop before it's ever recorded on
  // an intent (payment-operations.test.ts's cross-shop test covers that).
  //
  // Two phases: checkout/order/booking ids resolve first (phase one), since
  // a booking or checkout can itself point at a trip that isn't on any
  // intent directly — the trips query (phase two) has to wait for those
  // results to know the full set of trip ids it needs.
  const checkoutIds = [
    ...new Set(intents.flatMap((intent) => (intent.checkoutId ? [intent.checkoutId] : []))),
  ];
  const orderIds = [
    ...new Set(intents.flatMap((intent) => (intent.orderId ? [intent.orderId] : []))),
  ];
  const bookingIds = [
    ...new Set(intents.flatMap((intent) => (intent.bookingId ? [intent.bookingId] : []))),
  ];

  const [checkoutRows, orderRows, bookingRows] = await Promise.all([
    checkoutIds.length
      ? db
          .select({ id: bookingCheckouts.id, tripId: bookingCheckouts.tripId })
          .from(bookingCheckouts)
          .where(
            and(inArray(bookingCheckouts.id, checkoutIds), eq(bookingCheckouts.shopId, shopId)),
          )
      : [],
    orderIds.length
      ? db
          .select({ id: orders.id, personId: orders.personId })
          .from(orders)
          .where(and(inArray(orders.id, orderIds), eq(orders.shopId, shopId)))
      : [],
    bookingIds.length
      ? db
          .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
          .from(bookings)
          .where(and(inArray(bookings.id, bookingIds), eq(bookings.shopId, shopId)))
      : [],
  ]);
  const tripIdByCheckoutId = new Map(checkoutRows.map((row) => [row.id, row.tripId]));
  const personIdByOrderId = new Map(orderRows.map((row) => [row.id, row.personId]));
  const tripIdByBookingId = new Map(bookingRows.map((row) => [row.id, row.tripId]));
  const personIdByBookingId = new Map(bookingRows.map((row) => [row.id, row.personId]));

  const tripIds = [
    ...new Set([
      ...intents.flatMap((intent) => (intent.tripId ? [intent.tripId] : [])),
      ...checkoutRows.map((row) => row.tripId),
      ...bookingRows.map((row) => row.tripId),
    ]),
  ];
  const personIds = [
    ...new Set([
      ...orderRows.flatMap((row) => (row.personId ? [row.personId] : [])),
      ...bookingRows.map((row) => row.personId),
    ]),
  ];
  const [tripRows, personRows] = await Promise.all([
    tripIds.length
      ? db
          .select({ id: trips.id, title: trips.title })
          .from(trips)
          .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId)))
      : [],
    personIds.length
      ? db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          .where(and(inArray(people.id, personIds), eq(people.shopId, shopId)))
      : [],
  ]);
  const tripTitleById = new Map(tripRows.map((row) => [row.id, row.title]));
  const personNameById = new Map(personRows.map((row) => [row.id, row.fullName]));

  return intents.map((intent) => {
    const tripId =
      intent.tripId ??
      (intent.checkoutId ? tripIdByCheckoutId.get(intent.checkoutId) : undefined) ??
      (intent.bookingId ? tripIdByBookingId.get(intent.bookingId) : undefined);
    const personId =
      (intent.orderId ? personIdByOrderId.get(intent.orderId) : undefined) ??
      (intent.bookingId ? personIdByBookingId.get(intent.bookingId) : undefined);
    return {
      intent,
      tripId: tripId ?? null,
      tripTitle: tripId ? (tripTitleById.get(tripId) ?? null) : null,
      personName: personId ? (personNameById.get(personId) ?? null) : null,
    };
  });
}
