import { and, desc, eq, getViewSelectedFields, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { AppTransaction, DbExecutor } from "./client";
import { boundLockWaits } from "./lock-bounds";
import type {
  BookingPayment,
  ManualPaymentMethod,
  PaymentEventOperation,
  PaymentStatus,
} from "./schema";
import { bookingPaymentEvents, bookingPayments, bookings, trips } from "./schema";

/**
 * Serializes every write to one booking's payment entries through a lock on
 * the always-existing `bookings` row: there is no current-state row to lock
 * (`booking_payments` is a view), and an append takes no lock that would stop
 * a concurrent append from reading the same "current" entry. Without this, a staff "waived" write (via `setBookingPayment`,
 * which trusts the caller and previously took no lock at all) could race a
 * webhook's first payment cascade (via `setBookingPaymentIfNotFinal`) and
 * regress the booking back to "paid" — the exact regression CR-004 exists to
 * prevent, missed because the original fix only locked a row that's usually
 * absent on the write that matters (security review finding). `fn` runs with
 * the lock held for its full duration, inside the same transaction that took
 * it, so the lock and the write it guards always commit or roll back together.
 */
async function withBookingPaymentLock<T>(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  fn: (
    tx: AppTransaction,
    booking: { status: (typeof bookings.$inferSelect)["status"] },
  ) => Promise<T | null>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    await boundLockWaits(tx);
    const [booking] = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
      .for("update");
    if (!booking) return null;
    return fn(tx, booking);
  });
}

export type SetPaymentInput = {
  shopId: string;
  bookingId: string;
  status: PaymentStatus;
  amountCents?: number | null;
  /**
   * Required, not defaulted. The old `?? "usd"` meant the counter-cash path —
   * which passes no currency — wrote `usd` onto a Mexican shop's settled row,
   * and that row is what the diver's own confirmation panel reads back. A
   * settled amount is evidence, so the currency has to be stated by whoever
   * knows it rather than guessed here (ADR 20260731-shop-currency).
   */
  currency: string;
  provider?: string | null;
  providerRef?: string | null;
  note?: string | null;
  /** How a manual mark's money changed hands; null on every provider write. */
  method?: ManualPaymentMethod | null;
  /** The staffer making a manual mark; null on every provider write. */
  recordedByPersonId?: string | null;
  /**
   * What is causing this transition, for the append-only
   * `booking_payment_events` trail (DATA-M3, ADR
   * 20260803-booking-payment-events). Optional, defaulting to `manual_mark`,
   * because that is what an unannotated write *is*: a staff member setting the
   * status by hand from the roster or the diver record, which is the only
   * caller that does not already know a more specific code. Every machine
   * writer — the checkout cascade, the invoice cascades, the automated
   * cancellation refund — states its own.
   */
  operation?: PaymentEventOperation;
};

/**
 * Whether a write differs from the booking's current state in any way worth an
 * entry. Deliberately compares the whole material payload rather than just
 * `status`: a deposit topped up to a full fare, a refund re-pointed at a
 * different Stripe object, a staff note added, or the same mark made by a
 * different staffer are all real transitions even when the status word is
 * unchanged.
 *
 * A replayed Stripe webhook re-running the self-healing cascade in
 * `markCheckoutPaidBySessionId` changes none of these, so it appends nothing
 * and the booking's `updatedAt` keeps the time of the real transition
 * (ADR 20260803-booking-payment-events).
 */
function paymentStateChanged(
  previous: BookingPayment | null,
  next: Pick<
    BookingPayment,
    | "status"
    | "amountCents"
    | "currency"
    | "provider"
    | "providerRef"
    | "note"
    | "method"
    | "recordedByPersonId"
  >,
): boolean {
  if (!previous) return true;
  return (
    previous.status !== next.status ||
    previous.amountCents !== next.amountCents ||
    previous.currency !== next.currency ||
    previous.provider !== next.provider ||
    previous.providerRef !== next.providerRef ||
    previous.note !== next.note ||
    previous.method !== next.method ||
    previous.recordedByPersonId !== next.recordedByPersonId
  );
}

/** The booking's current state: the newest entry, read through the fold. */
async function currentPayment(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<BookingPayment | null> {
  const [payment] = await db
    .select()
    .from(bookingPayments)
    .where(and(eq(bookingPayments.shopId, shopId), eq(bookingPayments.bookingId, bookingId)))
    .limit(1);
  return payment ?? null;
}

/**
 * Record a booking's payment state by appending one entry to
 * `booking_payment_events`; the `booking_payments` view folds the newest entry
 * into the current state (issue #2716). Tenant-safe: the booking must belong
 * to the shop, so this is callable outside a route. Accepts a `DbExecutor`
 * (not just `AppDb`) so a caller already inside a transaction can pass its
 * `tx` through and get one atomic commit.
 *
 * Every call states the whole state, not a patch: `note`, `amountCents` and
 * the rest are what this call passes, so a later write that omits a note
 * clears it.
 *
 * **This is the one funnel.** Nothing else writes a booking's payment state —
 * `setBookingPaymentIfNotFinal` delegates here, and the checkout, order and
 * refund cascades all go through one of the two — so the read of the current
 * state, the comparison and the append all happen under the one per-booking
 * lock (DATA-M3, ADR 20260803-booking-payment-events).
 *
 * Returns the booking's state after the call: the new entry, or the unchanged
 * current state when nothing material changed. Null when the booking is not
 * this shop's.
 */
export async function setBookingPayment(
  db: DbExecutor,
  input: SetPaymentInput,
): Promise<BookingPayment | null> {
  return withBookingPaymentLock(db, input.shopId, input.bookingId, async (tx) => {
    const now = nowDate();
    const next = {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: input.status,
      amountCents: input.amountCents ?? null,
      currency: input.currency,
      provider: input.provider ?? null,
      providerRef: input.providerRef ?? null,
      note: input.note ?? null,
      method: input.method ?? null,
      recordedByPersonId: input.recordedByPersonId ?? null,
    };
    // Read under the same lock that guards the append below, never before it:
    // this is both the entry's `previous_status` and the "did anything
    // actually change?" comparison, and a value read outside the lock could
    // describe a state a concurrent write has already replaced.
    const previous = await currentPayment(tx, input.shopId, input.bookingId);
    if (!paymentStateChanged(previous, next)) return previous;
    const [entry] = await tx
      .insert(bookingPaymentEvents)
      .values({
        ...next,
        previousStatus: previous?.status ?? null,
        operation: input.operation ?? "manual_mark",
        occurredAt: now,
      })
      .returning({
        id: bookingPaymentEvents.id,
        occurredAt: bookingPaymentEvents.occurredAt,
        createdAt: bookingPaymentEvents.createdAt,
      });
    if (!entry) return null;
    return { ...next, id: entry.id, updatedAt: entry.occurredAt, createdAt: entry.createdAt };
  });
}

/**
 * A status a provider-webhook replay must never move a booking backward out
 * of — a human already refunded it, or explicitly waived it, and a duplicate
 * or out-of-order event describing an earlier point in the payment's history
 * must not undo that (CR-004).
 */
const FINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set(["refunded", "waived"]);

/**
 * Same contract as {@link setBookingPayment}, but refuses to write a lesser
 * status (e.g. "paid") over one already in {@link FINAL_PAYMENT_STATUSES}.
 * Provider-webhook reconciliation (checkout/order payment cascades) should
 * call this instead of `setBookingPayment` directly; ordinary staff writes —
 * including the refund/waive writes that produce those final states in the
 * first place — go through `setBookingPayment`, which trusts the caller.
 *
 * Both this function and `setBookingPayment` take the *same* per-booking
 * lock (`withBookingPaymentLock`), so a staff refund/waive write and a
 * replayed/duplicate webhook cascade landing concurrently always serialize
 * against each other, regardless of which function either one calls or
 * whether the booking has any entry yet (CR-004 review finding — see
 * `withBookingPaymentLock`'s comment for why the lock is on `bookings`).
 *
 * When this does swallow a write — a real payment landing after a refund or
 * waive, which today has no legitimate path back to "paid" — it logs rather
 * than failing silently; making that owner-visible in the product is CR-005
 * territory (reconciliation for indeterminate/orphaned payment operations).
 */
export async function setBookingPaymentIfNotFinal(db: AppTransaction, input: SetPaymentInput) {
  return withBookingPaymentLock(db, input.shopId, input.bookingId, async (tx, booking) => {
    // Re-checked under the same lock that guards the write below, not from
    // an earlier unlocked read by the caller (Codex finding): a caller like
    // `markCheckoutPaidBySessionId` reads booking status via a plain SELECT
    // before this lock is acquired, so a self-cancellation racing in between
    // that read and this lock would otherwise still let a provider-webhook
    // reconciliation write a phantom "paid" onto a seat that's already been
    // released. Scoped to `setBookingPaymentIfNotFinal` only (provider-webhook
    // reconciliation) — `setBookingPayment` still trusts the caller, since a
    // staff refund/waive write against a booking they just cancelled is the
    // normal, legitimate flow.
    if (booking.status === "cancelled") {
      log("payment.refused_cancelled_booking", "error", {
        shopId: input.shopId,
        bookingId: input.bookingId,
        attemptedStatus: input.status,
      });
      return null;
    }
    if (!FINAL_PAYMENT_STATUSES.has(input.status)) {
      const current = await currentPayment(tx, input.shopId, input.bookingId);
      if (current && FINAL_PAYMENT_STATUSES.has(current.status)) {
        log("payment.refused_final_status_regression", "error", {
          shopId: input.shopId,
          bookingId: input.bookingId,
          currentStatus: current.status,
          attemptedStatus: input.status,
        });
        return current;
      }
    }
    return setBookingPayment(tx, input);
  });
}

/**
 * One booking's money history, newest first — every recorded transition of its
 * payment state, including the captures a later refund superseded (DATA-M3).
 * Tenant-scoped like every other read here.
 *
 * `limit` bounds the read because this is a per-booking trail with no natural
 * ceiling: a long-lived booking can accumulate a deposit, a balance, a partial
 * refund and staff corrections. Callers that need a page beyond the newest
 * `limit` rows should move to the repo's shared paging (`src/db/paging.ts`)
 * rather than raising it.
 */
export async function listBookingPaymentEvents(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  limit = 50,
) {
  return db
    .select()
    .from(bookingPaymentEvents)
    .where(
      and(eq(bookingPaymentEvents.shopId, shopId), eq(bookingPaymentEvents.bookingId, bookingId)),
    )
    .orderBy(desc(bookingPaymentEvents.occurredAt), desc(bookingPaymentEvents.seq))
    .limit(limit);
}

/** One booking's current payment state, or null when it has no entry yet. */
export async function getBookingPayment(db: DbExecutor, shopId: string, bookingId: string) {
  return currentPayment(db, shopId, bookingId);
}

/**
 * Current payment status and source for a set of bookings, keyed by bookingId.
 * `provider` is "stripe" when a card was taken online, null for a manual mark —
 * enough for the roster to say *how* a booking was paid.
 */
export async function paymentsByBooking(db: DbExecutor, shopId: string, bookingIds: string[]) {
  const map = new Map<string, { status: PaymentStatus; provider: string | null }>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .select({
      bookingId: bookingPayments.bookingId,
      status: bookingPayments.status,
      provider: bookingPayments.provider,
    })
    .from(bookingPayments)
    .where(and(eq(bookingPayments.shopId, shopId), inArray(bookingPayments.bookingId, bookingIds)));
  for (const row of rows) map.set(row.bookingId, { status: row.status, provider: row.provider });
  return map;
}

/** Current booking payment records for one diver, with the trip that owns each booking. */
export async function listPersonBookingPayments(db: DbExecutor, shopId: string, personId: string) {
  return db
    .select({ payment: getViewSelectedFields(bookingPayments), booking: bookings, trip: trips })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
      ),
    )
    .orderBy(trips.startsAt);
}

export type PaymentEntrySeed = {
  shopId: string;
  bookingId: string;
  status: PaymentStatus;
  amountCents?: number | null;
  currency: string;
  provider?: string | null;
  providerRef?: string | null;
  note?: string | null;
  method?: ManualPaymentMethod | null;
  recordedByPersonId?: string | null;
  operation?: PaymentEventOperation;
  /** When the state was reached; falls back to `createdAt`, then the clock. */
  updatedAt?: Date;
  createdAt?: Date;
};

/**
 * Entry rows for demo data and tests that set a booking's payment state
 * directly, without the lock and comparison of {@link setBookingPayment}. Each
 * seed becomes one first entry (no `previous_status`), stamped with the time
 * the state was reached. A Stripe payment reads as a settled checkout, anything
 * else as a manual mark.
 */
export function paymentEntries(seeds: PaymentEntrySeed | readonly PaymentEntrySeed[]) {
  const list: readonly PaymentEntrySeed[] = Array.isArray(seeds) ? seeds : [seeds];
  return list.map(({ updatedAt, createdAt, operation, ...seed }) => ({
    ...seed,
    previousStatus: null,
    operation: operation ?? (seed.provider === "stripe" ? "checkout_settled" : "manual_mark"),
    occurredAt: updatedAt ?? createdAt ?? nowDate(),
    ...(createdAt ? { createdAt } : {}),
  }));
}
