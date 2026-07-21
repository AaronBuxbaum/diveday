import { and, eq, inArray } from "drizzle-orm";
import type { AppDb, DbExecutor } from "./client";
import type { PaymentStatus } from "./schema";
import { bookingPayments, bookings, trips } from "./schema";

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
 */
export async function setBookingPayment(db: AppDb, input: SetPaymentInput) {
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return null;

  const values = {
    shopId: input.shopId,
    bookingId: booking.id,
    status: input.status,
    amountCents: input.amountCents ?? null,
    currency: input.currency ?? "usd",
    provider: input.provider ?? null,
    providerRef: input.providerRef ?? null,
    note: input.note ?? null,
    updatedAt: new Date(),
  };
  const [payment] = await db
    .insert(bookingPayments)
    .values(values)
    .onConflictDoUpdate({ target: bookingPayments.bookingId, set: values })
    .returning();
  return payment ?? null;
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
