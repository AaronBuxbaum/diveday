/**
 * **What the roster's Paid mark shows and starts from** (batch 6 item 1), one
 * read per departure: per seat, the amount a hand mark recorded, how it was
 * paid and who marked it, and what the seat still owes — the figure the
 * amount field opens holding, so taking the usual fare is one tap.
 */
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { seatBalanceOwedCents, seatListPriceCents } from "@/lib/deposits";
import type { ManualPaymentMethodCode } from "@/lib/payment-marks";
import type { AppDb, DbExecutor } from "./client";
import { bookingPayments, bookings, courses, people, shops, trips } from "./schema";
import { tripRosterOrder, tripRosterWhere } from "./trips-roster";

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

/** The staffer who recorded a hand mark: `people` again, beside the seat's own person. */
const markRecorder = alias(people, "payment_mark_recorder");

/** The columns a seat's Paid mark is worked out from, shop-scoped on every table. */
const markColumns = {
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
  recordedByName: markRecorder.fullName,
  shopCurrency: shops.currency,
};

type MarkRow = {
  participantType: (typeof bookings.$inferSelect)["participantType"];
  trip: {
    priceCents: number | null;
    snorkelerPriceCents: number | null;
    riderPriceCents: number | null;
  };
  courseTitle: string | null;
  coursePriceCents: number | null;
  courseELearningPriceCents: number | null;
  paymentStatus: (typeof bookingPayments.$inferSelect)["status"] | null;
  paymentAmountCents: number | null;
  paymentCurrency: string | null;
  paymentMethod: ManualPaymentMethodCode | null;
  recordedByName: string | null;
  shopCurrency: string;
};

function markFacts(row: MarkRow): PaymentMarkFacts {
  const course =
    row.courseTitle !== null
      ? {
          title: row.courseTitle,
          priceCents: row.coursePriceCents,
          eLearningPriceCents: row.courseELearningPriceCents,
        }
      : null;
  const listPriceCents = seatListPriceCents(row.trip, course, row.participantType);
  return {
    shopCurrency: row.shopCurrency,
    balanceOwedCents: seatBalanceOwedCents(
      listPriceCents,
      row.paymentStatus ? { status: row.paymentStatus, amountCents: row.paymentAmountCents } : null,
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
  };
}

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
    .select({ bookingId: bookings.id, ...markColumns })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .leftJoin(
      markRecorder,
      and(eq(markRecorder.id, bookingPayments.recordedByPersonId), eq(markRecorder.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: read for a departure the roster page has already resolved.
    .where(and(eq(bookings.tripId, tripId), eq(bookings.shopId, shopId)));
  return new Map(rows.map((row) => [row.bookingId, markFacts(row)]));
}

/**
 * **The roster and its Paid marks in one statement**: `getTripRoster`'s seats,
 * in its order, with what `paymentMarkFactsForTrip` reads joined beside each.
 * The roster page reads both, and a second statement over the same seats was
 * one more query on every departure it opens (`staff-render-cost.test.ts`).
 */
export async function getTripRosterWithPaymentMarks(db: AppDb, shopId: string, tripId: string) {
  const rows = await db
    .select({ booking: bookings, person: people, ...markColumns })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(courses, and(eq(courses.id, trips.courseId), eq(courses.shopId, shopId)))
    .leftJoin(
      bookingPayments,
      and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
    )
    .leftJoin(
      markRecorder,
      and(eq(markRecorder.id, bookingPayments.recordedByPersonId), eq(markRecorder.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: read for a departure the roster page has already resolved.
    .where(tripRosterWhere(shopId, tripId))
    .orderBy(...tripRosterOrder);
  return {
    roster: rows.map(({ booking, person }) => ({ booking, person })),
    paymentMarksByBooking: new Map(rows.map((row) => [row.booking.id, markFacts(row)])),
  };
}
