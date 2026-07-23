import { and, count, countDistinct, eq, gte, inArray, isNull, lt, sum } from "drizzle-orm";
import type { MonthlyReportInput, ReportTrip } from "@/lib/reporting";
import type { DbExecutor } from "./client";
import { bookingPayments, bookings, trips, waiverRecords } from "./schema";

/** Bookings that still count as "on the boat" — the roster set, not cancellations. */
const ACTIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;
/** Payment states that represent money actually collected (a deposit is partial, but real). */
const COLLECTED_PAYMENT_STATUSES = ["paid", "deposit_paid"] as const;

/**
 * The month's numbers, anchored to trips that *departed* in `[startUtc, endUtc)`.
 * Returns the raw per-trip rows and the revenue total; all the derived rates
 * live in the pure `summarizeMonth` (src/lib/reporting.ts) so this file stays a
 * thin, timezone-agnostic query — the caller converts the shop-local month into
 * the UTC window with src/lib/zoned.ts.
 *
 * Three deliberately separate queries rather than one wide join: mixing a
 * bookings count and a waiver-completed count in a single grouped select
 * double-counts across the join fan-out, and revenue lives on a different table
 * entirely. Each query is obviously correct on its own.
 */
export async function getMonthlyReport(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<MonthlyReportInput> {
  const inWindow = and(
    eq(trips.shopId, shopId),
    gte(trips.startsAt, startUtc),
    lt(trips.startsAt, endUtc),
  );

  // Trip spine: every trip in the window with its capacity and active-booking
  // count. A left join keeps trips that sailed empty (count 0), which still
  // offered seats and belong in the fill-rate denominator.
  const tripRows = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      capacity: trips.capacity,
      activeBookings: count(bookings.id),
    })
    .from(trips)
    .leftJoin(
      bookings,
      and(eq(bookings.tripId, trips.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])),
    )
    .where(inWindow)
    .groupBy(trips.id, trips.title, trips.startsAt, trips.capacity);

  // Waiver-complete bookings per trip: active bookings that carry a current
  // (completed, non-superseded) waiver. countDistinct on the booking id so a
  // stray second waiver row never inflates the count past its bookings.
  const waiverRows = await db
    .select({
      tripId: trips.id,
      waiverComplete: countDistinct(bookings.id),
    })
    .from(trips)
    .innerJoin(
      bookings,
      and(eq(bookings.tripId, trips.id), inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES])),
    )
    .innerJoin(
      waiverRecords,
      and(
        eq(waiverRecords.bookingId, bookings.id),
        eq(waiverRecords.status, "completed"),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .where(inWindow)
    .groupBy(trips.id);

  // Money collected on this month's trips: paid + deposit booking payments,
  // reached through the booking to its trip's departure date.
  const [revenueRow] = await db
    .select({ total: sum(bookingPayments.amountCents) })
    .from(bookingPayments)
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        inArray(bookingPayments.status, [...COLLECTED_PAYMENT_STATUSES]),
        gte(trips.startsAt, startUtc),
        lt(trips.startsAt, endUtc),
      ),
    );

  const waiverByTrip = new Map(waiverRows.map((row) => [row.tripId, Number(row.waiverComplete)]));

  const reportTrips: ReportTrip[] = tripRows.map((row) => ({
    tripId: row.tripId,
    title: row.title,
    startsAt: row.startsAt,
    capacity: row.capacity,
    activeBookings: Number(row.activeBookings),
    waiverComplete: waiverByTrip.get(row.tripId) ?? 0,
  }));

  return {
    trips: reportTrips,
    revenueCents: Number(revenueRow?.total ?? 0),
  };
}
