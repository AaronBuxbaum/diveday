/**
 * **One reader for unfinished work** (issue #2703): every row a ledger still
 * owes someone, asked in the attempt grammar of `src/lib/attempts.ts`.
 *
 * A kind is a filter, not a module: `payment_operation` is the intents still in
 * flight past the payment window, `media_deletion` the deletes that failed or
 * died mid-call, `processor_erasure` the erasure halves still owed,
 * `shop_cancellation_refund` the captured seats on cancelled departures, and
 * `failed_refund` the refunds Stripe reversed and nobody has made again. The
 * rule for when each is stuck lives in `ATTEMPT_RULES`, once.
 *
 * Each surface still asks for its own kinds and words them itself: Orders the
 * money (`PayoutLines`), Settings' Data group the erasure halves (`DataGroup`),
 * Today what is loud. There is no staff surface for the notification send
 * queue's parked rows, and there should not be one (#1826): operator logging
 * owns those.
 *
 * Every read is shop-scoped in the query, never filtered by a caller: these
 * rows name money and erasures in one shop's Stripe account.
 */

import { and, asc, desc, eq, inArray, isNull, lt, not, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  type LedgerKind,
  stuckBefore,
  type UnfinishedKind,
  unfinishedStatuses,
} from "@/lib/attempts";
import { nowDate } from "@/lib/clock";
import { capturedPaymentStatuses } from "@/lib/payment-source";
import type { AppDb } from "./client";
import { heldUnattributedRefund } from "./payment-operations";
import type {
  MediaDeletionAttempt,
  PaymentOperationIntent,
  ProcessorErasureObligation,
} from "./schema";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  mediaDeletionAttempts,
  orders,
  paymentOperationIntents,
  people,
  processorErasureObligations,
  stripeRefundFailures,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";

export type StuckPaymentOperation = {
  intent: PaymentOperationIntent;
  tripId: string | null;
  tripTitle: string | null;
  personName: string | null;
};

/** One seat whose departure the shop cancelled and whose money never went back. */
export type OwedShopCancellationRefund = {
  bookingId: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
  diverName: string;
  /** Null for a counter mark that recorded no amount — staff know what they took. */
  amountCents: number | null;
  currency: string;
  /** Only the deposit was ever captured, so only the deposit is owed back. */
  depositOnly: boolean;
  /** When this money became owed: the trip's `cancelled_at`, else the payment's stamp. */
  since: Date;
};

export type FailedRefund = {
  id: string;
  orderId: string | null;
  checkoutId: string | null;
  tripId: string | null;
  tripTitle: string | null;
  diverNames: string[];
  /** Still owed: the failed amount, less whatever has been refunded again since. */
  amountCents: number;
  currency: string;
  failedAt: Date;
};

/** What each kind's filter returns. */
export type UnfinishedRows = {
  payment_operation: StuckPaymentOperation;
  media_deletion: MediaDeletionAttempt;
  processor_erasure: ProcessorErasureObligation;
  shop_cancellation_refund: OwedShopCancellationRefund;
  failed_refund: FailedRefund;
};

export type UnfinishedOptions = {
  /**
   * Rows that became unfinished before this count. Defaults to the kind's own
   * window from the app clock (`stuckBefore`); Today passes its own `now`
   * through `raisedOnTodayBefore`, and tests inject a fixed date. `null` reads
   * with no window. Owed erasures and failed refunds take no cutoff at all:
   * they are listed at any age, whatever a caller passes.
   */
  olderThan?: Date | null;
  /** How many rows one read returns. The money queues are panels, not ledgers. */
  limit?: number;
  /**
   * `payment_operation` only: leave out the dashboard refunds held for staff
   * to match to a seat. The Orders index lists those in a queue of their own
   * (`listUnattributedRefunds`, issue #2293); Today keeps counting them.
   */
  withoutUnattributedRefunds?: boolean;
};

/**
 * The grammar's question asked of one ledger's columns: a status the kind
 * lists at any age, or a status in flight since before `olderThan`.
 */
function ledgerUnfinished(
  kind: LedgerKind,
  status: PgColumn,
  since: PgColumn,
  olderThan: Date | null,
): SQL {
  const { windowed, always } = unfinishedStatuses(kind);
  const clauses: SQL[] = [];
  if (always.length > 0) clauses.push(inArray(status, always));
  if (windowed.length > 0) {
    clauses.push(
      olderThan
        ? (and(inArray(status, windowed), lt(since, olderThan)) as SQL)
        : inArray(status, windowed),
    );
  }
  // An empty `or()` is no filter at all: every row of the shop, done ones
  // included. A kind that lists nothing is a mistake in ATTEMPT_RULES.
  if (clauses.length === 0) throw new Error(`unfinished: ${kind} lists no status`);
  return or(...clauses) as SQL;
}

/**
 * The media-deletion filter without a shop, for the bounded cross-shop retry
 * pass (`retryPendingMediaDeletions`). Every other read goes through
 * {@link listUnfinished}.
 */
export function unfinishedMediaDeletionWhere(olderThan: Date | null): SQL {
  return ledgerUnfinished(
    "media_deletion",
    mediaDeletionAttempts.status,
    mediaDeletionAttempts.createdAt,
    olderThan,
  );
}

type KindReader<K extends UnfinishedKind> = (
  db: AppDb,
  shopId: string,
  olderThan: Date | null,
  options: UnfinishedOptions,
) => Promise<UnfinishedRows[K][]>;

/**
 * Intents still `started` past the payment window: the process died mid-call,
 * or between the call succeeding and the local write that should have
 * followed. These are the "orphaned or indeterminate" operations CR-005
 * requires be owner-visible rather than silently stuck forever; staff check
 * the intent's `stripeObjectId` (if any) against the Stripe dashboard and
 * reconcile by hand.
 */
const paymentOperations: KindReader<"payment_operation"> = async (
  db,
  shopId,
  olderThan,
  options,
) => {
  const intents = await db
    .select()
    .from(paymentOperationIntents)
    .where(
      and(
        eq(paymentOperationIntents.shopId, shopId),
        ledgerUnfinished(
          "payment_operation",
          paymentOperationIntents.status,
          paymentOperationIntents.startedAt,
          olderThan,
        ),
        options.withoutUnattributedRefunds ? not(heldUnattributedRefund()) : undefined,
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
          // diveday:any-checkout-purpose: names the trip of whichever checkout a stuck intent is about
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
          .where(and(inArray(trips.id, tripIds), eq(trips.shopId, shopId), liveTrip()))
      : [],
    personIds.length
      ? db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          // diveday:allow-deleted-people: names for the stuck-operation queue, removed people included.
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
};

/** Deletes an owner needs to see and can retry: the panel in Settings' Data group. */
const mediaDeletions: KindReader<"media_deletion"> = async (db, shopId, olderThan) =>
  db
    .select()
    .from(mediaDeletionAttempts)
    .where(and(eq(mediaDeletionAttempts.shopId, shopId), unfinishedMediaDeletionWhere(olderThan)))
    .orderBy(mediaDeletionAttempts.createdAt);

/**
 * This shop's still-owed erasure obligations, oldest first: the panel in
 * Settings' Data group. An obligation names a record in one shop's Stripe
 * account and has no business being readable from another's.
 */
const processorErasures: KindReader<"processor_erasure"> = async (db, shopId) =>
  db
    .select()
    .from(processorErasureObligations)
    .where(
      and(
        eq(processorErasureObligations.shopId, shopId),
        ledgerUnfinished(
          "processor_erasure",
          processorErasureObligations.status,
          processorErasureObligations.createdAt,
          null,
        ),
      ),
    )
    .orderBy(asc(processorErasureObligations.createdAt));

/** How many owed refunds one read returns. A panel, not a ledger. */
const OWED_REFUND_LIMIT = 50;

/**
 * Money the shop owes divers for departures it cancelled and could not refund
 * automatically.
 *
 * There is no `refund_owed` column and there should not be one. This residue is
 * *derivable* — a seat still holding a capture on a trip that no longer exists —
 * and a stored flag would have to be reconciled with Stripe every time a staff
 * member handed the cash back, which is exactly the drift a queue like this is
 * meant to remove.
 *
 * The predicate mirrors `refundBookingsForShopCancelledTrip`'s own set, seat for
 * seat, so this lists precisely what that cascade left behind and nothing else.
 * In particular it excludes a **cancelled booking**, and that exclusion is
 * load-bearing rather than incidental: a diver who cancelled inside no window
 * forfeited their fare and still reads `paid`, and the shop does not owe them
 * anything just because the departure was later called off
 * (ADR 20260813-shop-cancellation-refunds-itself).
 *
 * A seat that *was* refunded reads `refunded`, not `paid`, so it never appears —
 * the obvious way to get this wrong.
 *
 * Newest money first, so the seat a shop is most likely to be asked about is on
 * top.
 */
const shopCancellationRefunds: KindReader<"shop_cancellation_refund"> = async (
  db,
  shopId,
  olderThan,
  options,
) => {
  const rows = await db
    .select({
      bookingId: bookings.id,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
      diverName: people.fullName,
      amountCents: bookingPayments.amountCents,
      currency: bookingPayments.currency,
      paymentStatus: bookingPayments.status,
      // When the money became owed, which is when the shop called the trip off
      // -- not when the diver paid. `cancelledAt` is null only for departures
      // cancelled before that column existed, and those fall back to the
      // payment stamp so the panel still has a date to show.
      since: sql<Date>`coalesce(${trips.cancelledAt}, ${bookingPayments.updatedAt})`,
    })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, [...capturedPaymentStatuses]),
        eq(trips.status, "cancelled"),
        // The forfeit carve-out — see the doc comment above.
        seatNotCancelled,
        // Bounded on the cancellation, with a NULL treated as **stale**: a trip
        // cancelled before this column existed has been owed for a while by
        // definition, and failing toward showing the money is the right
        // direction to fail.
        olderThan
          ? (or(isNull(trips.cancelledAt), lt(trips.cancelledAt, olderThan)) as SQL<unknown>)
          : undefined,
      ),
    )
    // Refunds owed on one cancelled trip share its cancellation time; the
    // diver's name, then the id, break that tie so the limit always keeps the
    // same rows in the same order.
    .orderBy(
      desc(sql`coalesce(${trips.cancelledAt}, ${bookingPayments.updatedAt})`),
      asc(people.fullName),
      asc(bookingPayments.id),
    )
    .limit(options.limit ?? OWED_REFUND_LIMIT);

  return rows.map(({ paymentStatus, ...row }) => ({
    ...row,
    depositOnly: paymentStatus === "deposit_paid",
  }));
};

const QUEUE_LIMIT = 50;

/**
 * The Orders index queue: refunds that failed and have not been made again.
 * Money captured after its checkout closed is left to its own queue
 * (`listPaidAfterCloseCheckouts`), which already owes it.
 */
const failedRefunds: KindReader<"failed_refund"> = async (db, shopId, _olderThan, options) => {
  const targetRefunded = sql<number>`coalesce(${orders.refundedCents}, ${bookingCheckouts.refundedCents}, 0)`;
  const rows = await db
    .select({
      id: stripeRefundFailures.id,
      orderId: stripeRefundFailures.orderId,
      checkoutId: stripeRefundFailures.checkoutId,
      bookingId: stripeRefundFailures.bookingId,
      orderPersonId: orders.personId,
      orderBookingId: orders.bookingId,
      checkoutTripId: bookingCheckouts.tripId,
      amountCents: stripeRefundFailures.amountCents,
      owedUntil: stripeRefundFailures.owedUntilRefundedCents,
      refundedNow: targetRefunded,
      currency: stripeRefundFailures.currency,
      failedAt: stripeRefundFailures.failedAt,
    })
    .from(stripeRefundFailures)
    .leftJoin(orders, and(eq(orders.id, stripeRefundFailures.orderId), eq(orders.shopId, shopId)))
    .leftJoin(
      bookingCheckouts,
      // diveday:any-checkout-purpose: a refund failure is recorded against a fare or a tip, the checkout findStripePaymentTarget returned
      and(
        eq(bookingCheckouts.id, stripeRefundFailures.checkoutId),
        eq(bookingCheckouts.shopId, shopId),
      ),
    )
    .where(
      and(
        eq(stripeRefundFailures.shopId, shopId),
        isNull(bookingCheckouts.paidAfterCloseAt),
        sql`${targetRefunded} < ${stripeRefundFailures.owedUntilRefundedCents}`,
      ),
    )
    .orderBy(asc(stripeRefundFailures.failedAt))
    .limit(options.limit ?? QUEUE_LIMIT);
  if (rows.length === 0) return [];

  // Whose money: the seat the failure restored, the order's customer, or
  // everyone the checkout covered.
  const checkoutIds = rows.flatMap((row) =>
    row.checkoutId && !row.bookingId ? [row.checkoutId] : [],
  );
  const seatIds = rows.flatMap((row) => [row.bookingId, row.orderBookingId].filter(isString));
  const personIds = rows.flatMap((row) => (row.orderPersonId ? [row.orderPersonId] : []));
  const [checkoutSeats, seats, persons] = await Promise.all([
    checkoutIds.length
      ? db
          .select({
            checkoutId: bookingCheckoutBookings.checkoutId,
            fullName: people.fullName,
          })
          .from(bookingCheckoutBookings)
          // diveday:any-checkout-purpose: a refund failure is recorded against a fare or a tip, the checkout findStripePaymentTarget returned
          .innerJoin(
            bookings,
            and(eq(bookings.id, bookingCheckoutBookings.bookingId), eq(bookings.shopId, shopId)),
          )
          .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
          .where(
            and(
              eq(bookingCheckoutBookings.shopId, shopId),
              inArray(bookingCheckoutBookings.checkoutId, checkoutIds),
            ),
          )
          .orderBy(asc(bookings.createdAt))
      : [],
    seatIds.length
      ? db
          .select({ id: bookings.id, tripId: bookings.tripId, fullName: people.fullName })
          .from(bookings)
          .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
          .where(and(eq(bookings.shopId, shopId), inArray(bookings.id, seatIds)))
      : [],
    personIds.length
      ? db
          .select({ id: people.id, fullName: people.fullName })
          .from(people)
          // diveday:allow-deleted-people: the name on a past refund, which a later removal does not change.
          .where(and(eq(people.shopId, shopId), inArray(people.id, personIds)))
      : [],
  ]);
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const personById = new Map(persons.map((person) => [person.id, person.fullName]));
  const namesByCheckout = new Map<string, string[]>();
  for (const { checkoutId, fullName } of checkoutSeats) {
    namesByCheckout.set(checkoutId, [...(namesByCheckout.get(checkoutId) ?? []), fullName]);
  }
  const tripIds = [
    ...new Set([
      ...rows.flatMap((row) => (row.checkoutTripId ? [row.checkoutTripId] : [])),
      ...seats.map((seat) => seat.tripId),
    ]),
  ];
  const tripRows = tripIds.length
    ? await db
        .select({ id: trips.id, title: trips.title })
        .from(trips)
        // diveday:allow-deleted-trips: a departure deleted since still names the money owed on it.
        .where(and(eq(trips.shopId, shopId), inArray(trips.id, tripIds)))
    : [];
  const tripTitle = new Map(tripRows.map((trip) => [trip.id, trip.title]));

  return rows.map((row) => {
    const seat = seatById.get(row.bookingId ?? row.orderBookingId ?? "");
    const tripId = row.checkoutTripId ?? seat?.tripId ?? null;
    const diverNames = seat
      ? [seat.fullName]
      : row.orderPersonId
        ? [personById.get(row.orderPersonId) ?? ""].filter(Boolean)
        : (namesByCheckout.get(row.checkoutId ?? "") ?? []);
    return {
      id: row.id,
      orderId: row.orderId,
      checkoutId: row.checkoutId,
      tripId,
      tripTitle: tripId ? (tripTitle.get(tripId) ?? null) : null,
      diverNames,
      amountCents: Math.min(row.amountCents, row.owedUntil - Number(row.refundedNow)),
      currency: row.currency,
      failedAt: row.failedAt,
    };
  });
};

function isString(value: string | null): value is string {
  return value !== null;
}

const READERS: { [K in UnfinishedKind]: KindReader<K> } = {
  payment_operation: paymentOperations,
  media_deletion: mediaDeletions,
  processor_erasure: processorErasures,
  shop_cancellation_refund: shopCancellationRefunds,
  failed_refund: failedRefunds,
};

/** One kind's unfinished rows for one shop. */
export async function listUnfinished<K extends UnfinishedKind>(
  db: AppDb,
  shopId: string,
  kind: K,
  options: UnfinishedOptions = {},
): Promise<UnfinishedRows[K][]> {
  const olderThan =
    options.olderThan === undefined ? stuckBefore(kind, nowDate()) : options.olderThan;
  return (READERS[kind] as KindReader<K>)(db, shopId, olderThan, options);
}

/**
 * Several kinds in one call, each with its own options: a surface names the
 * kinds it shows and gets each back under its own key.
 */
export async function readUnfinished<K extends UnfinishedKind>(
  db: AppDb,
  shopId: string,
  kinds: { [P in K]: UnfinishedOptions },
): Promise<{ [P in K]: UnfinishedRows[P][] }> {
  const entries = await Promise.all(
    (Object.keys(kinds) as K[]).map(
      async (kind) => [kind, await listUnfinished(db, shopId, kind, kinds[kind])] as const,
    ),
  );
  return Object.fromEntries(entries) as { [P in K]: UnfinishedRows[P][] };
}
