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

export type ResolvePaymentOperationInput = {
  status: "succeeded" | "failed";
  stripeObjectId?: string;
  errorMessage?: string;
};

/** Record how the Stripe call this intent describes actually resolved. */
export async function resolvePaymentOperation(
  db: DbExecutor,
  intentId: string,
  input: ResolvePaymentOperationInput,
): Promise<void> {
  await db
    .update(paymentOperationIntents)
    .set({
      status: input.status,
      stripeObjectId: input.stripeObjectId ?? null,
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

  // Batched lookups, not a join: a checkout_session intent's trip and an
  // invoice/refund intent's order->person live on different tables, and only
  // one of those references is ever set per intent (schema.ts comment).
  const tripIds = [...new Set(intents.flatMap((intent) => (intent.tripId ? [intent.tripId] : [])))];
  const checkoutIds = [
    ...new Set(intents.flatMap((intent) => (intent.checkoutId ? [intent.checkoutId] : []))),
  ];
  const orderIds = [
    ...new Set(intents.flatMap((intent) => (intent.orderId ? [intent.orderId] : []))),
  ];

  const [tripRows, checkoutRows, orderRows] = await Promise.all([
    tripIds.length
      ? db
          .select({ id: trips.id, title: trips.title })
          .from(trips)
          .where(inArray(trips.id, tripIds))
      : [],
    checkoutIds.length
      ? db
          .select({ id: bookingCheckouts.id, tripId: bookingCheckouts.tripId })
          .from(bookingCheckouts)
          .where(inArray(bookingCheckouts.id, checkoutIds))
      : [],
    orderIds.length
      ? db
          .select({ id: orders.id, personId: orders.personId })
          .from(orders)
          .where(inArray(orders.id, orderIds))
      : [],
  ]);
  const tripTitleById = new Map(tripRows.map((row) => [row.id, row.title]));
  const tripIdByCheckoutId = new Map(checkoutRows.map((row) => [row.id, row.tripId]));
  const personIdByOrderId = new Map(orderRows.map((row) => [row.id, row.personId]));

  const personIds = [...new Set(orderRows.flatMap((row) => (row.personId ? [row.personId] : [])))];
  const personRows = personIds.length
    ? await db
        .select({ id: people.id, fullName: people.fullName })
        .from(people)
        .where(inArray(people.id, personIds))
    : [];
  const personNameById = new Map(personRows.map((row) => [row.id, row.fullName]));

  return intents.map((intent) => {
    const tripId =
      intent.tripId ?? (intent.checkoutId ? tripIdByCheckoutId.get(intent.checkoutId) : undefined);
    const personId = intent.orderId ? personIdByOrderId.get(intent.orderId) : undefined;
    return {
      intent,
      tripId: tripId ?? null,
      tripTitle: tripId ? (tripTitleById.get(tripId) ?? null) : null,
      personName: personId ? (personNameById.get(personId) ?? null) : null,
    };
  });
}
