import { and, eq, ne } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { bookingCheckoutBookings, bookingCheckouts, bookings, trips } from "@/db/schema";

/**
 * A diver paid on a checkout DiveDay had already closed (issue #2335): the
 * money waits on the Orders index as owed back, with a Refund.
 */
export async function seedPaidAfterClose(db: AppDb, shopId: string, now: Date): Promise<void> {
  const [lateSeat] = await db
    .select({ id: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        ne(bookings.status, "cancelled"),
        eq(trips.status, "scheduled"),
      ),
    )
    .orderBy(trips.startsAt, bookings.createdAt)
    .limit(1);
  if (lateSeat) {
    const [lateCheckout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shopId,
        tripId: lateSeat.tripId,
        status: "expired",
        stripeAccountId: "acct_e2e_late",
        stripeSessionId: "cs_e2e_paid_after_close",
        currency: "usd",
        amountPerDiverCents: 14_500,
        totalCents: 14_500,
        paidAfterCloseAt: now,
        paidAfterCloseCents: 14_500,
      })
      .onConflictDoNothing()
      .returning({ id: bookingCheckouts.id });
    if (lateCheckout) {
      await db
        .insert(bookingCheckoutBookings)
        .values({ shopId: shopId, checkoutId: lateCheckout.id, bookingId: lateSeat.id });
    }
  }
}
