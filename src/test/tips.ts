import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { bookingCheckoutBookings, bookingCheckouts, bookings } from "@/db/schema";

/**
 * A test's tip, in the shape the old `tips` table took, written as what a tip
 * is since issue #2718: a `booking_checkouts` row with purpose `tip` and one
 * booking link, on the booking's own departure. `paid` is the checkout's
 * `completed`.
 */
export type TipFixture = {
  shopId: string;
  bookingId: string;
  status?: "pending" | "paid" | "expired";
  stripeAccountId?: string;
  stripeSessionId: string;
  stripeCustomerId?: string | null;
  stripePaymentIntentId?: string | null;
  checkoutUrl?: string | null;
  currency?: string;
  amountCents: number;
  expiresAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
};

export async function insertTip(db: DbExecutor, tip: TipFixture) {
  const [booking] = await db
    .select({ tripId: bookings.tripId })
    .from(bookings)
    .where(eq(bookings.id, tip.bookingId))
    .limit(1);
  if (!booking) throw new Error("insertTip: booking missing");
  const status = tip.status === "paid" ? "completed" : (tip.status ?? "pending");
  const [row] = await db
    .insert(bookingCheckouts)
    .values({
      shopId: tip.shopId,
      tripId: booking.tripId,
      purpose: "tip",
      status,
      stripeAccountId: tip.stripeAccountId ?? "acct_test",
      stripeSessionId: tip.stripeSessionId,
      stripeCustomerId: tip.stripeCustomerId ?? null,
      stripePaymentIntentId: tip.stripePaymentIntentId ?? null,
      checkoutUrl: tip.checkoutUrl ?? null,
      currency: tip.currency ?? "usd",
      amountPerDiverCents: tip.amountCents,
      totalCents: tip.amountCents,
      settledTotalCents: status === "completed" ? tip.amountCents : null,
      expiresAt: tip.expiresAt ?? null,
      completedAt: tip.completedAt ?? null,
      ...(tip.createdAt ? { createdAt: tip.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("insertTip: insert failed");
  await db.insert(bookingCheckoutBookings).values({
    shopId: tip.shopId,
    checkoutId: row.id,
    bookingId: tip.bookingId,
  });
  return row;
}

/** Every tip in a shop, for a test that counts or ages them. */
export function tipsOf(db: DbExecutor, shopId: string) {
  return db
    .select()
    .from(bookingCheckouts)
    .where(and(eq(bookingCheckouts.shopId, shopId), eq(bookingCheckouts.purpose, "tip")));
}
