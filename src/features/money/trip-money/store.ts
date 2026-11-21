/**
 * **Wrapped up's Money card** (ADR 20261117-trip-page-clock): one departure's
 * money, read from what is already recorded, no new state. Each seat's
 * current payment (`booking_payments`, the newest entry), what it still owes
 * (`paymentMarkFactsForTrip`, the roster's own arithmetic), and the rental
 * gear it paid for: a completed checkout's gear subtotal and a paid order's
 * rental lines, each less its share of what was refunded. Shop-scoped on
 * every table.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { fareCheckout } from "@/db/checkout-purpose";
import { queryAll } from "@/db/query-helpers";
import { seatNotCancelled } from "@/db/trips";
import type { DbExecutor } from "../../../db/client";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  orderLineItems,
  orders,
} from "../../../db/schema/index";
import { paymentMarkFactsForTrip } from "../payment-marks";
import { netOfRefund, type TripMoney, tallyTripMoney } from "./rules";

export async function getTripMoney(
  db: DbExecutor,
  shop: { id: string; currency: string },
  tripId: string,
): Promise<TripMoney> {
  const shopId = shop.id;
  const ofTrip = and(eq(bookings.tripId, tripId), eq(bookings.shopId, shopId));
  const [seats, facts, gear, rentalLines] = await queryAll(db, [
    () =>
      db
        .select({
          bookingId: bookings.id,
          live: sql<boolean>`(${seatNotCancelled})`,
          paymentStatus: bookingPayments.status,
          amountCents: bookingPayments.amountCents,
          paymentCurrency: bookingPayments.currency,
        })
        .from(bookings)
        .leftJoin(
          bookingPayments,
          and(eq(bookingPayments.bookingId, bookings.id), eq(bookingPayments.shopId, shopId)),
        )
        .where(ofTrip),
    () => paymentMarkFactsForTrip(db, shopId, tripId),
    () =>
      db
        .select({
          bookingId: bookingCheckoutBookings.bookingId,
          cents: bookingCheckoutBookings.gearCents,
          totalCents: bookingCheckouts.totalCents,
          refundedCents: bookingCheckouts.refundedCents,
        })
        .from(bookingCheckoutBookings)
        .innerJoin(
          bookingCheckouts,
          and(
            eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId),
            eq(bookingCheckouts.shopId, shopId),
            eq(bookingCheckouts.tripId, tripId),
            eq(bookingCheckouts.status, "completed"),
            // A seat's own checkout, never a post-trip tip (issue #2718).
            fareCheckout(),
          ),
        )
        .where(eq(bookingCheckoutBookings.shopId, shopId)),
    () =>
      db
        .select({
          bookingId: orders.bookingId,
          cents: sql<string>`sum(${orderLineItems.quantity} * ${orderLineItems.unitAmountCents})`,
          totalCents: orders.totalCents,
          refundedCents: orders.refundedCents,
        })
        .from(orderLineItems)
        .innerJoin(
          orders,
          and(
            eq(orders.id, orderLineItems.orderId),
            eq(orders.shopId, shopId),
            eq(orders.status, "paid"),
          ),
        )
        .innerJoin(bookings, and(eq(bookings.id, orders.bookingId), ofTrip))
        .where(and(eq(orderLineItems.shopId, shopId), inArray(orderLineItems.kind, ["rental"])))
        .groupBy(orders.id),
  ]);
  const rental = new Map<string, number>();
  for (const row of [...gear, ...rentalLines]) {
    if (!row.bookingId) continue;
    const kept = netOfRefund(
      Number(row.cents ?? 0),
      Number(row.totalCents ?? 0),
      Number(row.refundedCents ?? 0),
    );
    rental.set(row.bookingId, (rental.get(row.bookingId) ?? 0) + kept);
  }
  return tallyTripMoney(
    seats.map((seat) => ({
      live: Boolean(seat.live),
      paymentStatus: seat.paymentStatus,
      amountCents: seat.amountCents,
      paymentCurrency: seat.paymentCurrency,
      owedCents: facts.get(seat.bookingId)?.balanceOwedCents ?? null,
      rentalCents: rental.get(seat.bookingId) ?? 0,
    })),
    shop.currency,
  );
}
