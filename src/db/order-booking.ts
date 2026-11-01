/**
 * **The booking an order was raised for, as the order page names it** (third
 * UX review, item 32). A deposit order read "Trip deposit (Deposit) $54.00"
 * and nothing else: which departure, on what date, and what the seat still
 * owes were on the new-order form and lost once it was sent. This is the one
 * read that puts them back on the order.
 */
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookingPayments, bookings, courses, trips } from "./schema";
import { seatBalanceOwedCentsFromJoinedRow } from "./seat-balance";

export type OrderBookingContext = {
  bookingId: string;
  tripId: string;
  tripTitle: string;
  tripStartsAt: Date;
  /** What the seat still owes after what was collected, or null when nothing is. */
  balanceOwedCents: number | null;
};

/**
 * Shop-scoped on every table it touches: the booking, its trip, the trip's
 * course and the seat's payment row each carry `shopId`, so a booking id
 * copied from another shop's order resolves to nothing.
 */
export async function getOrderBookingContext(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<OrderBookingContext | null> {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      participantType: bookings.participantType,
      trip: {
        id: trips.id,
        title: trips.title,
        startsAt: trips.startsAt,
        priceCents: trips.priceCents,
        snorkelerPriceCents: trips.snorkelerPriceCents,
        riderPriceCents: trips.riderPriceCents,
      },
      courseTitle: courses.title,
      coursePriceCents: courses.priceCents,
      courseELearningPriceCents: courses.eLearningPriceCents,
      paymentStatus: bookingPayments.status,
      paymentAmountCents: bookingPayments.amountCents,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: an order names the departure it was raised for, deleted or not.
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  return {
    bookingId: row.bookingId,
    tripId: row.trip.id,
    tripTitle: row.trip.title,
    tripStartsAt: row.trip.startsAt,
    balanceOwedCents: seatBalanceOwedCentsFromJoinedRow(row),
  };
}
