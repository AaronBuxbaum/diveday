import { and, asc, eq, gt, isNull, not, or } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { bookingPayments, bookings, shops, trips } from "@/db/schema";
import { liveTrip } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { seatCheckoutCharge } from "@/lib/deposits";
import { unsupportedTripCreditSource } from "./sources";

/** Advisory quotes only. Redemption repeats every eligibility and price check under locks. */
export async function tripCreditBookingOptions(
  db: DbExecutor,
  shopId: string,
  personId: string,
  bookingId?: string,
) {
  const rows = await db
    .select({ booking: bookings, trip: trips })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.shopId, shopId), eq(bookingPayments.bookingId, bookings.id)),
    )
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.personId, personId),
        bookingId ? eq(bookings.id, bookingId) : undefined,
        eq(bookings.status, "booked"),
        isNull(bookings.identityUnconfirmedAt),
        eq(bookings.wantsNitrox, false),
        eq(trips.status, "scheduled"),
        liveTrip(),
        isNull(trips.courseId),
        eq(trips.isPrivate, false),
        eq(trips.isRehearsal, false),
        gt(trips.startsAt, nowDate()),
        eq(shops.taxEnabled, false),
        isNull(shops.passThroughFee),
        or(
          isNull(bookingPayments.id),
          and(eq(bookingPayments.status, "unpaid"), isNull(bookingPayments.provider)),
        ),
        not(unsupportedTripCreditSource(shopId, bookings.id)),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.title), asc(bookings.id))
    .limit(20);
  return rows.flatMap(({ booking, trip }) => {
    if (booking.paidRentalKinds.length) return [];
    const charge = seatCheckoutCharge(trip, null, booking.participantType);
    return charge
      ? [
          {
            bookingId: booking.id,
            tripId: trip.id,
            title: trip.title,
            startsAt: trip.startsAt,
            fareCents: charge.amountCents + charge.balanceDueCents,
          },
        ]
      : [];
  });
}
