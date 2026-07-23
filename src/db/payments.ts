import { and, eq, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { AppTransaction, DbExecutor } from "./client";
import type { PaymentStatus } from "./schema";
import { bookingPayments, bookings, trips } from "./schema";

/**
 * Serializes every write to one booking's payment row through a lock on the
 * always-existing `bookings` row, rather than locking `booking_payments`
 * itself — `SELECT ... FOR UPDATE` on a row that doesn't exist yet takes no
 * lock at all in Postgres, and a booking's *first* payment event is exactly
 * that case. Without this, a staff "waived" write (via `setBookingPayment`,
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
  fn: (tx: AppTransaction) => Promise<T | null>,
): Promise<T | null> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
      .for("update");
    if (!booking) return null;
    return fn(tx);
  });
}

export type SetPaymentInput = {
  shopId: string;
  bookingId: string;
  status: PaymentStatus;
  amountCents?: number | null;
  currency?: string;
  provider?: string | null;
  providerRef?: string | null;
  note?: string | null;
};

/**
 * Record a booking's current payment state — one row per booking. Tenant-safe:
 * the booking must belong to the shop, so this is callable outside a route.
 * Accepts a `DbExecutor` (not just `AppDb`) so a caller already inside a
 * transaction can pass its `tx` through and get one atomic commit.
 *
 * A full-row upsert: every call replaces `note`/`amountCents`/etc. wholesale,
 * not just `status`. No current caller writes a `note` on a non-final status,
 * so this is only a latent concern today — but a future non-final write that
 * sets `note` would have it silently reset to null by the next replay of
 * `setBookingPaymentIfNotFinal`'s cascade (CR-004 review finding).
 */
export async function setBookingPayment(db: DbExecutor, input: SetPaymentInput) {
  return withBookingPaymentLock(db, input.shopId, input.bookingId, async (tx) => {
    const values = {
      shopId: input.shopId,
      bookingId: input.bookingId,
      status: input.status,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? "usd",
      provider: input.provider ?? null,
      providerRef: input.providerRef ?? null,
      note: input.note ?? null,
      updatedAt: nowDate(),
    };
    const [payment] = await tx
      .insert(bookingPayments)
      .values(values)
      .onConflictDoUpdate({ target: bookingPayments.bookingId, set: values })
      .returning();
    return payment ?? null;
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
 * whether a `booking_payments` row exists yet (CR-004 review finding — see
 * `withBookingPaymentLock`'s comment for why locking `booking_payments`
 * itself was insufficient).
 *
 * When this does swallow a write — a real payment landing after a refund or
 * waive, which today has no legitimate path back to "paid" — it logs rather
 * than failing silently; making that owner-visible in the product is CR-005
 * territory (reconciliation for indeterminate/orphaned payment operations).
 */
export async function setBookingPaymentIfNotFinal(db: AppTransaction, input: SetPaymentInput) {
  return withBookingPaymentLock(db, input.shopId, input.bookingId, async (tx) => {
    if (!FINAL_PAYMENT_STATUSES.has(input.status)) {
      const [current] = await tx
        .select()
        .from(bookingPayments)
        .where(
          and(
            eq(bookingPayments.shopId, input.shopId),
            eq(bookingPayments.bookingId, input.bookingId),
          ),
        )
        .limit(1);
      if (current && FINAL_PAYMENT_STATUSES.has(current.status)) {
        console.error("setBookingPaymentIfNotFinal: refused to regress a final payment status", {
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

export async function getBookingPayment(db: DbExecutor, shopId: string, bookingId: string) {
  const [payment] = await db
    .select()
    .from(bookingPayments)
    .where(and(eq(bookingPayments.shopId, shopId), eq(bookingPayments.bookingId, bookingId)))
    .limit(1);
  return payment ?? null;
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
    .select({ payment: bookingPayments, booking: bookings, trip: trips })
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
