import { and, countDistinct, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  checkoutKeptRatio,
  type OrderLineKind,
  orderKeptRatio,
  packageDiveValueCents,
  type RevenueLine,
  type RevenueLinePart,
  revenueByLine,
  revenueLineForOrderItem,
} from "@/lib/report-lines";
import type { DbExecutor } from "./client";
import { queryAll } from "./query-helpers";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  divePackageEntitlements,
  divePackages,
  orderLineItems,
  orders,
  trips,
  workOrderBills,
} from "./schema";
import { liveTrip } from "./trips-live";

/**
 * The three facts the Reports page adds under the month's headline figures
 * (owner decision 2026-10-09): the money by line, what the shop still owes in
 * unused package dives, and how many of the month's divers had been out with
 * the shop before. The rules live in `src/lib/report-lines.ts`; this reads the
 * rows behind them.
 */
export type MonthMoneyDetail = {
  /** Paid in the calendar month, net of tax, pass-through and refunds; zero lines left out. */
  lines: Array<{ line: RevenueLine; cents: number }>;
  /** Unused, unexpired package dives at the end of the window (or now, for the current month). */
  packageDivesOwed: { dives: number; valueCents: number };
  /** Distinct divers on this month's departures, and how many had dived with the shop before. */
  divers: { total: number; returning: number };
};

/** Same set the roster and every other report figure count as "on the boat". */
const ACTIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;
/** An order the shop still holds money on; a fully refunded one holds none. */
const KEPT_ORDER_STATUSES = ["paid", "partly_refunded"] as const;

export async function getMonthMoneyDetail(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
  now: Date,
): Promise<MonthMoneyDetail> {
  const [lines, packageDivesOwed, divers] = await queryAll(db, [
    () => moneyByLine(db, shopId, startUtc, endUtc),
    () => packageDivesOwedAt(db, shopId, endUtc < now ? endUtc : now),
    () => returningDivers(db, shopId, startUtc, endUtc),
  ]);
  return { lines, packageDivesOwed, divers };
}

async function moneyByLine(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<Array<{ line: RevenueLine; cents: number }>> {
  // Every line of every invoice paid in the window. Whether the invoice bills
  // a gear-bench job, and whether its booking's departure is a course session,
  // decide the line; each line's kept share is the order's own.
  const orderLines = await db
    .select({
      kind: orderLineItems.kind,
      quantity: orderLineItems.quantity,
      unitAmountCents: orderLineItems.unitAmountCents,
      amountPaidCents: orders.amountPaidCents,
      totalCents: orders.totalCents,
      workOrder: sql<boolean>`exists (select 1 from ${workOrderBills} where ${workOrderBills.orderId} = ${orders.id} and ${workOrderBills.shopId} = ${shopId})`,
      courseTrip: sql<boolean>`${trips.courseId} is not null`,
    })
    .from(orderLineItems)
    .innerJoin(orders, and(eq(orders.id, orderLineItems.orderId), eq(orders.shopId, shopId)))
    .leftJoin(bookings, and(eq(bookings.id, orders.bookingId), eq(bookings.shopId, shopId)))
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(orderLineItems.shopId, shopId),
        inArray(orders.status, [...KEPT_ORDER_STATUSES]),
        gte(orders.paidAt, startUtc),
        lt(orders.paidAt, endUtc),
      ),
    );

  // Every seat of every booking checkout completed in the window: its trip
  // ask goes to Courses or Fun dives by its departure, its gear to Rentals,
  // and its pass-through nowhere.
  const checkoutSeats = await db
    .select({
      tripCents: sql<number>`coalesce(${bookingCheckoutBookings.tripCents}, ${bookingCheckouts.amountPerDiverCents})`,
      gearCents: bookingCheckoutBookings.gearCents,
      totalCents: bookingCheckouts.totalCents,
      settledTotalCents: bookingCheckouts.settledTotalCents,
      taxCents: bookingCheckouts.taxCents,
      refundedCents: bookingCheckouts.refundedCents,
      courseTrip: sql<boolean>`${trips.courseId} is not null`,
    })
    .from(bookingCheckoutBookings)
    .innerJoin(
      bookingCheckouts,
      and(
        eq(bookingCheckouts.id, bookingCheckoutBookings.checkoutId),
        eq(bookingCheckouts.shopId, shopId),
      ),
    )
    .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        eq(bookingCheckouts.status, "completed"),
        gte(bookingCheckouts.completedAt, startUtc),
        lt(bookingCheckouts.completedAt, endUtc),
      ),
    );

  const parts: RevenueLinePart[] = [];
  for (const row of orderLines) {
    const line = revenueLineForOrderItem(row.kind as OrderLineKind, {
      workOrder: Boolean(row.workOrder),
      courseTrip: Boolean(row.courseTrip),
    });
    if (!line) continue;
    parts.push({
      line,
      cents: row.quantity * row.unitAmountCents,
      keptRatio: orderKeptRatio(row),
    });
  }
  for (const row of checkoutSeats) {
    const keptRatio = checkoutKeptRatio(row);
    parts.push({
      line: row.courseTrip ? "courses" : "funDives",
      cents: Number(row.tripCents),
      keptRatio,
    });
    parts.push({ line: "rentals", cents: row.gearCents, keptRatio });
  }
  return revenueByLine(parts);
}

/**
 * Package dives sold and not yet taken at `asOf`, and what they are worth at
 * the price each was bought for.
 *
 * Read back in time rather than off the current state, so last March's report
 * says what was owed at the end of last March: a dive granted by then, not
 * spent by then (`consumed_at` empty or later), and not lapsed by then. Only
 * on an order the shop still holds money for — a refunded package is owed
 * nothing.
 */
async function packageDivesOwedAt(
  db: DbExecutor,
  shopId: string,
  asOf: Date,
): Promise<{ dives: number; valueCents: number }> {
  const rows = await db
    .select({
      dives: sql<number>`count(distinct ${divePackageEntitlements.id})`,
      unitAmountCents: orderLineItems.unitAmountCents,
      diveCount: divePackages.diveCount,
    })
    .from(divePackageEntitlements)
    .innerJoin(
      orders,
      and(eq(orders.id, divePackageEntitlements.orderId), eq(orders.shopId, shopId)),
    )
    .innerJoin(
      divePackages,
      and(eq(divePackages.id, divePackageEntitlements.packageId), eq(divePackages.shopId, shopId)),
    )
    .innerJoin(
      orderLineItems,
      and(
        eq(orderLineItems.orderId, divePackageEntitlements.orderId),
        eq(orderLineItems.packageId, divePackageEntitlements.packageId),
        eq(orderLineItems.shopId, shopId),
        eq(orderLineItems.kind, "dive_package"),
      ),
    )
    .where(
      and(
        eq(divePackageEntitlements.shopId, shopId),
        inArray(orders.status, [...KEPT_ORDER_STATUSES]),
        lt(divePackageEntitlements.createdAt, asOf),
        or(
          isNull(divePackageEntitlements.consumedAt),
          gte(divePackageEntitlements.consumedAt, asOf),
        ),
        or(isNull(divePackageEntitlements.expiresAt), gt(divePackageEntitlements.expiresAt, asOf)),
      ),
    )
    .groupBy(orderLineItems.id, orderLineItems.unitAmountCents, divePackages.diveCount);
  let dives = 0;
  let valueCents = 0;
  for (const row of rows) {
    const count = Number(row.dives);
    dives += count;
    valueCents += count * packageDiveValueCents(row);
  }
  return { dives, valueCents };
}

/**
 * The month's divers, and how many had been out with the shop before it.
 *
 * Counted on the basis every other figure on the page uses — active bookings
 * on this month's live departures that were not called off — and "before" means an
 * active booking on a departure that left earlier than this month began, so a
 * diver's second boat this month does not make them a returning diver.
 */
async function returningDivers(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<{ total: number; returning: number }> {
  const [row] = await db
    .select({
      total: countDistinct(bookings.personId),
      returning: sql<number>`count(distinct ${bookings.personId}) filter (where exists (
        select 1 from ${bookings} as earlier
        join ${trips} as earlier_trip on earlier_trip.id = earlier.trip_id
        where earlier.shop_id = ${shopId}
          and earlier.person_id = ${bookings.personId}
          and earlier.status in ('booked', 'checked_in')
          and earlier_trip.shop_id = ${shopId}
          and earlier_trip.status = 'scheduled'
          and earlier_trip.deleted_at is null
          and earlier_trip.starts_at < ${startUtc.toISOString()}::timestamptz
      ))`,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.status, [...ACTIVE_BOOKING_STATUSES]),
        ne(trips.status, "cancelled"),
        liveTrip(),
        gte(trips.startsAt, startUtc),
        lt(trips.startsAt, endUtc),
      ),
    );
  return { total: Number(row?.total ?? 0), returning: Number(row?.returning ?? 0) };
}
