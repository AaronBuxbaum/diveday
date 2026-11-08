import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { bookingPayments, bookings, trips } from "../../db/schema/index";
import { nowDate } from "../../lib/clock";

/**
 * **Somebody is owed money**: a departure the shop cancelled that still
 * carries a paid seat. the owed-refund read (`src/db/unfinished.ts`) joins a paid
 * booking_payment to a `cancelled` trip whose booking is *not* cancelled (the
 * forfeit carve-out), so cancelling the trip is the whole edit.
 *
 * **Opt-in** (`?owedRefund=1`, issue #2338): the departure it cancels is one of
 * the demo's upcoming boats, which Today, the board and the booking pages all
 * read, so running it on every call made every caller's picture depend on
 * whether this state had been seeded first.
 *
 * The departure is the soonest upcoming one with a paid seat, named so the
 * pick never rides on the physical order of the payment rows.
 */
export async function cancelADepartureSomebodyPaidFor(db: AppDb, shopId: string) {
  const [paidSeat] = await db
    .select({ tripId: bookings.tripId })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, ["paid", "deposit_paid"]),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title))
    .limit(1);
  if (paidSeat) {
    await db
      .update(trips)
      .set({ status: "cancelled" })
      .where(and(eq(trips.id, paidSeat.tripId), eq(trips.shopId, shopId)));
  }
}
