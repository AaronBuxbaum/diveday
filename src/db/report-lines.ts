import {
  and,
  countDistinct,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
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
import { type BuddyReferrer, buddyReferrersForWindow } from "./buddy-referrals";
import type { DbExecutor } from "./client";
import { packageOrderStillBacks } from "./dive-packages";
import { listShopPayoutsArriving, type ShopPayout } from "./payouts";
import { queryAll } from "./query-helpers";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  divePackageEntitlements,
  divePackages,
  importedPaymentHistory,
  orderLineItems,
  orders,
  paymentDisputes,
  trips,
  workOrderBills,
} from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

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
  /**
   * What left the month's money (UX review 2026-10-11, item 17), on the same
   * paid-in-the-month basis as `lines`: refunds of money paid this month, what
   * discount codes took off this month's checkouts, and Stripe's fees on the
   * payouts that reached the bank this month — null when no payout this month
   * says what its fees were, which is not the same as none.
   */
  out: {
    refundedCents: number;
    discountedCents: number;
    stripeFeesCents: number | null;
    /** Card disputes lost this month: their reversal lines, by the day each was lost (issue #2292). */
    disputesLostCents: number;
  };
  /** Stripe payouts arriving at the bank this month, oldest first (ADR 20261012-payouts-reach-diveday). */
  payouts: ShopPayout[];
  /** The divers whose buddy links brought this month's buddy seats, most friends first (fifth-loop ideas, item 41). */
  buddyReferrers: BuddyReferrer[];
};

/** Same set the roster and every other report figure count as "on the boat". */
const ACTIVE_BOOKING_STATUSES = ["booked", "checked_in"] as const;
/** An order the shop still holds money on; a fully refunded one holds none. */
const KEPT_ORDER_STATUSES = ["paid", "partly_refunded"] as const;

/** Money a staff member marked by hand: what the booking holds now, not a refunded or waived one. */
const MARKED_PAYMENT_STATUSES = ["paid", "deposit_paid", "partly_refunded"] as const;

/** A month's UTC calendar bounds, or the given window when no month is named. */
function payoutWindow(
  month: { year: number; month: number } | undefined,
  from: Date,
  to: Date,
): { from: Date; to: Date } {
  if (!month) return { from, to };
  return {
    from: new Date(Date.UTC(month.year, month.month - 1, 1)),
    to: new Date(Date.UTC(month.year, month.month, 1)),
  };
}

export async function getMonthMoneyDetail(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
  now: Date,
  /** The shop's currency and zone: imported history is counted in that currency, by its own calendar day. */
  shopMoney: { currency: string; timeZone: string },
  /**
   * The calendar month a payout's arrival day is read against. Stripe states
   * that day at UTC midnight, so payouts are read over the month's UTC
   * calendar bounds rather than the shop's: a shop's month starts hours after
   * a payout that arrives on its first day. Absent, the month's own bounds.
   */
  payoutMonth?: { year: number; month: number },
): Promise<MonthMoneyDetail> {
  const [lines, packageDivesOwed, divers, out, payouts, buddyReferrers] = await queryAll(db, [
    () => moneyByLine(db, shopId, startUtc, endUtc, shopMoney),
    () => packageDivesOwedAt(db, shopId, endUtc < now ? endUtc : now),
    () => returningDivers(db, shopId, startUtc, endUtc),
    () => moneyOut(db, shopId, startUtc, endUtc),
    () => listShopPayoutsArriving(db, shopId, payoutWindow(payoutMonth, startUtc, endUtc)),
    () => buddyReferrersForWindow(db, shopId, startUtc, endUtc),
  ]);
  const paidFees = payouts.flatMap((payout) =>
    payout.status === "paid" && payout.feeCents !== null ? [payout.feeCents] : [],
  );
  return {
    lines,
    packageDivesOwed,
    divers,
    out: {
      ...out,
      stripeFeesCents: paidFees.length > 0 ? paidFees.reduce((sum, fee) => sum + fee, 0) : null,
    },
    payouts,
    buddyReferrers,
  };
}

/**
 * Refunds and discounts on the money paid in the window. Every figure is a
 * stored row's own: `refunded_cents` is what Stripe reported reversing (or
 * DiveDay refunded), and a checkout's discount is the snapshot taken when the
 * code was handed to Stripe (`applied_discount_cents`, or the percent of the
 * asked total), never re-derived from a code as it reads today.
 */
async function moneyOut(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<{ refundedCents: number; discountedCents: number; disputesLostCents: number }> {
  const [orderRefunds] = await db
    .select({ total: sql<string>`coalesce(sum(${orders.refundedCents}), 0)` })
    .from(orders)
    .where(and(eq(orders.shopId, shopId), gte(orders.paidAt, startUtc), lt(orders.paidAt, endUtc)));
  const [checkoutMoney] = await db
    .select({
      refunded: sql<string>`coalesce(sum(${bookingCheckouts.refundedCents}), 0)`,
      discounted: sql<string>`coalesce(sum(coalesce(
        ${bookingCheckouts.appliedDiscountCents},
        round(${bookingCheckouts.totalCents} * ${bookingCheckouts.appliedDiscountPercent} / 100.0)
      )), 0)`,
    })
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.shopId, shopId),
        eq(bookingCheckouts.status, "completed"),
        gte(bookingCheckouts.completedAt, startUtc),
        lt(bookingCheckouts.completedAt, endUtc),
      ),
    );
  const [lostDisputes] = await db
    .select({ total: sql<string>`coalesce(sum(${paymentDisputes.amountCents}), 0)` })
    .from(paymentDisputes)
    .where(
      and(
        eq(paymentDisputes.shopId, shopId),
        gte(paymentDisputes.reversedAt, startUtc),
        lt(paymentDisputes.reversedAt, endUtc),
      ),
    );
  return {
    refundedCents: Number(orderRefunds?.total ?? 0) + Number(checkoutMoney?.refunded ?? 0),
    discountedCents: Number(checkoutMoney?.discounted ?? 0),
    disputesLostCents: Number(lostDisputes?.total ?? 0),
  };
}

async function moneyByLine(
  db: DbExecutor,
  shopId: string,
  startUtc: Date,
  endUtc: Date,
  shopMoney: { currency: string; timeZone: string },
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
    // diveday:allow-rehearsal: money only, and a rehearsal can never be
    // invoiced (`issueOrder` refuses its seats).
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
    // diveday:allow-rehearsal: money only, and a rehearsal can never be
    // checked out (`startBookingCheckout` refuses it).
    .innerJoin(trips, and(eq(trips.id, bookingCheckouts.tripId), eq(trips.shopId, shopId)))
    .where(
      and(
        eq(bookingCheckoutBookings.shopId, shopId),
        eq(bookingCheckouts.status, "completed"),
        gte(bookingCheckouts.completedAt, startUtc),
        lt(bookingCheckouts.completedAt, endUtc),
      ),
    );

  // Every booking a staff member marked paid by hand (cash at the desk, a
  // transfer), on its departure's line, by the day the mark was last set
  // (issue #2305). Only rows no provider wrote: a Stripe-settled seat is
  // counted through its checkout or invoice above, and a prepaid package dive
  // was money on the day the package sold. `amount_cents` is what the booking
  // still holds, so a part refund is already off it.
  const markedSeats = await db
    .select({
      amountCents: bookingPayments.amountCents,
      courseTrip: sql<boolean>`${trips.courseId} is not null`,
    })
    .from(bookingPayments)
    .innerJoin(
      bookings,
      and(eq(bookings.id, bookingPayments.bookingId), eq(bookings.shopId, shopId)),
    )
    // diveday:allow-deleted-trips: a departure with a booking cannot be deleted (`deleteTrip`'s `has_roster`), and money marked is money taken; a cleared rehearsal is left out by `notRehearsal()`.
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId), notRehearsal()))
    .where(
      and(
        eq(bookingPayments.shopId, shopId),
        isNull(bookingPayments.provider),
        inArray(bookingPayments.status, [...MARKED_PAYMENT_STATUSES]),
        isNotNull(bookingPayments.amountCents),
        gte(bookingPayments.updatedAt, startUtc),
        lt(bookingPayments.updatedAt, endUtc),
      ),
    );

  // History carried from the shop's previous system, net of its refunds, on
  // the rule the month's Revenue already counts it by (`getMonthlyReport`):
  // only amounts the import could read in the shop's own currency, on the
  // shop's own calendar days. It names no line of its own, so it is one.
  const [importedNet] = await db
    .select({
      cents: sql<string>`coalesce(sum(case when ${importedPaymentHistory.direction} = 'payment' then ${importedPaymentHistory.amountCents} else -${importedPaymentHistory.amountCents} end), 0)`,
    })
    .from(importedPaymentHistory)
    .where(
      and(
        eq(importedPaymentHistory.shopId, shopId),
        eq(importedPaymentHistory.currency, shopMoney.currency),
        isNotNull(importedPaymentHistory.amountCents),
        inArray(importedPaymentHistory.direction, ["payment", "refund"]),
        gte(
          importedPaymentHistory.occurredOn,
          calendarDateInTimezone(startUtc, shopMoney.timeZone),
        ),
        lt(importedPaymentHistory.occurredOn, calendarDateInTimezone(endUtc, shopMoney.timeZone)),
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
  for (const row of markedSeats) {
    parts.push({
      line: row.courseTrip ? "courses" : "funDives",
      cents: row.amountCents ?? 0,
      keptRatio: 1,
    });
  }
  parts.push({ line: "imported", cents: Number(importedNet?.cents ?? 0), keptRatio: 1 });
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
 *
 * Also the "Dives owed on packages" line under Dive packages, at now (fourth
 * UX review, item 20).
 */
export async function packageDivesOwedAt(
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
        // What a diver can still spend is what the shop still owes: the same
        // rule, so a refunded or lost-dispute package is owed by neither.
        packageOrderStillBacks(),
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
          and not earlier_trip.is_rehearsal
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
        notRehearsal(),
        gte(trips.startsAt, startUtc),
        lt(trips.startsAt, endUtc),
      ),
    );
  return { total: Number(row?.total ?? 0), returning: Number(row?.returning ?? 0) };
}
