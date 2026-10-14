/**
 * **What the roster's Paid mark shows and starts from** (batch 6 item 1), one
 * read per departure: per seat, the amount a hand mark recorded, how it was
 * paid and who marked it, and what the seat still owes — the figure the
 * amount field opens holding, so taking the usual fare is one tap.
 */
import { and, eq } from "drizzle-orm";
import { seatBalanceOwedCents, seatListPriceCents } from "@/lib/deposits";
import type { ManualPaymentMethodCode } from "@/lib/payment-marks";
import type { DbExecutor } from "./client";
import { bookingPayments, bookings, courses, people, shops, trips } from "./schema";

export type PaymentMarkFacts = {
  /** The shop's currency: what an amount typed into the mark is read in. */
  shopCurrency: string;
  /** What the seat still owes, or null when it owes nothing or names no price. */
  balanceOwedCents: number | null;
  /** The last hand mark that recorded money, while it is the seat's current state. */
  mark: {
    amountCents: number;
    currency: string;
    method: ManualPaymentMethodCode;
    /** The staffer who marked it, or null once their record is gone. */
    recordedByName: string | null;
  } | null;
};

/**
 * Shop-scoped on every table it touches, like `getOrderBookingContext`, whose
 * price arithmetic this shares (`seatListPriceCents`, `seatBalanceOwedCents`).
 * Called with a departure the page has already resolved for this shop.
 */
export async function paymentMarkFactsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<Map<string, PaymentMarkFacts>> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      participantType: bookings.participantType,
      trip: {
        priceCents: trips.priceCents,
        snorkelerPriceCents: trips.snorkelerPriceCents,
        riderPriceCents: trips.riderPriceCents,
      },
      courseTitle: courses.title,
      coursePriceCents: courses.priceCents,
      courseELearningPriceCents: courses.eLearningPriceCents,
      paymentStatus: bookingPayments.status,
      paymentAmountCents: bookingPayments.amountCents,
      paymentCurrency: bookingPayments.currency,
      paymentMethod: bookingPayments.method,
      recordedByName: people.fullName,
      shopCurrency: shops.currency,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .leftJoin(
      people,
      and(eq(people.id, bookingPayments.recordedByPersonId), eq(people.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: read for a departure the roster page has already resolved.
    .where(and(eq(bookings.tripId, tripId), eq(bookings.shopId, shopId)));

  const facts = new Map<string, PaymentMarkFacts>();
  for (const row of rows) {
    const course =
      row.courseTitle !== null
        ? {
            title: row.courseTitle,
            priceCents: row.coursePriceCents,
            eLearningPriceCents: row.courseELearningPriceCents,
          }
        : null;
    const listPriceCents = seatListPriceCents(row.trip, course, row.participantType);
    facts.set(row.bookingId, {
      shopCurrency: row.shopCurrency,
      balanceOwedCents: seatBalanceOwedCents(
        listPriceCents,
        row.paymentStatus
          ? { status: row.paymentStatus, amountCents: row.paymentAmountCents }
          : null,
      ),
      mark:
        row.paymentMethod && row.paymentAmountCents !== null && row.paymentCurrency
          ? {
              amountCents: row.paymentAmountCents,
              currency: row.paymentCurrency,
              method: row.paymentMethod,
              recordedByName: row.recordedByName,
            }
          : null,
    });
  }
  return facts;
}
