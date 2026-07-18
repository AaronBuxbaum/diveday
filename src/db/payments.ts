import { and, eq, inArray } from "drizzle-orm";
import type { AppDb, DbExecutor } from "./client";
import type { PaymentStatus } from "./schema";
import { bookingPayments, bookings } from "./schema";

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

/** Current payment rows for a set of bookings, keyed by bookingId. */
export async function paymentsByBooking(db: DbExecutor, shopId: string, bookingIds: string[]) {
  const map = new Map<string, PaymentStatus>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .select({ bookingId: bookingPayments.bookingId, status: bookingPayments.status })
    .from(bookingPayments)
    .where(and(eq(bookingPayments.shopId, shopId), inArray(bookingPayments.bookingId, bookingIds)));
  for (const row of rows) map.set(row.bookingId, row.status);
  return map;
}
