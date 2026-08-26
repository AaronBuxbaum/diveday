/**
 * Owner reporting math. Pure and framework-free: the db layer (src/db/reporting.ts)
 * fetches a month's trips — capacity, active-booking count, and how many of those
 * bookings carry a completed waiver — plus the money collected on them; every
 * derived number (fill rate, waiver completion, the headline percentages) is
 * computed and formatted here so the arithmetic is exhaustively unit-testable
 * without a database.
 *
 * The one real modelling decision: a monthly report is anchored to the trips that
 * *departed* in the month, in the shop's timezone. Bookings, fill rate, and
 * waiver completion all live naturally on those trips; revenue starts with the
 * money actually collected on their bookings (booking_payments — the same
 * paid/deposit amounts that gate boarding). It then includes only the explicit,
 * unverified import slice whose payment/refund amount and currency were clear;
 * the report surface names that addition and links to its source rows. See docs
 * ADR 20260723-owner-reporting and 20260816-imported-payment-history-is-evidence.
 */

import { cachedFormatter } from "./intl-cache";
import { minorToMajor } from "./money";

/** One trip's contribution to a month, as the db layer hands it up. */
export type ReportTrip = {
  tripId: string;
  title: string;
  startsAt: Date;
  capacity: number;
  /** Active bookings only — `booked` + `checked_in`; cancelled / no-show excluded. */
  activeBookings: number;
  /** Of those active bookings, how many carry a completed, non-superseded waiver. */
  waiverComplete: number;
};

export type MonthlyReportInput = {
  trips: ReportTrip[];
  /** Net minor units: current trip revenue less tax, plus imported payments minus refunds. */
  revenueCents: number;
  /** Tax included in verified DiveDay-collected payments; imported history has no tax evidence. */
  taxCents: number;
  /** Unverified imported source payments included in revenueCents for this calendar month. */
  importedPaymentCents: number;
  /** Unverified imported source refunds subtracted from revenueCents for this calendar month. */
  importedRefundCents: number;
  /** How many imported source rows supplied either aggregate amount above. */
  importedFinancialRecordCount: number;
  /**
   * Minor units of *settled* post-trip tips on this month's trips (PAY-M2).
   * Kept beside `revenueCents` rather than folded into it: a tip is 100% the
   * shop's, never touches the booking payment gate, and is charged on its own
   * Stripe session (docs ADR 20260726-post-trip-tipping) — adding it to
   * "payments and deposits taken" would make the revenue card stop meaning
   * what its own detail line says. Both numbers are on the page, so the month
   * reconciles against Stripe without either one lying.
   */
  tipsCents: number;
  /** How many tips that total is made of — the tip card's detail line. */
  tipCount: number;
};

export type MonthlyReport = {
  /** Trips that departed in the month. */
  tripCount: number;
  /** Total seats offered across those trips (sum of capacity). */
  seatsOffered: number;
  /** Seats taken — the total active bookings, i.e. the month's bookings count. */
  seatsBooked: number;
  /** seatsBooked / seatsOffered in [0, 1], or null when no seats were offered. */
  fillRate: number | null;
  /** Trips that left with no open seat. */
  atCapacityTrips: number;
  /** Net minor units: current trip revenue less tax plus the clearly-labelled imported source slice. */
  revenueCents: number;
  /** Tax included in verified DiveDay-collected payments, shown separately from net revenue. */
  taxCents: number;
  /** Unverified imported source payments included in revenueCents. */
  importedPaymentCents: number;
  /** Unverified imported source refunds subtracted from revenueCents. */
  importedRefundCents: number;
  /** Source rows behind the imported financial contribution. */
  importedFinancialRecordCount: number;
  /** Minor units of settled tips on the month's trips — never inside `revenueCents`. */
  tipsCents: number;
  /** How many tips made that total. */
  tipCount: number;
  /** Active bookings whose waiver is signed. */
  waiverComplete: number;
  /** Active bookings still missing a signed waiver. */
  waiverOutstanding: number;
  /** waiverComplete / seatsBooked in [0, 1], or null when there were no bookings. */
  waiverCompletion: number | null;
};

/** Bookings on active statuses. Mirrors the roster's "who is on this boat" set. */
export function summarizeMonth(input: MonthlyReportInput): MonthlyReport {
  const seatsOffered = input.trips.reduce((sum, trip) => sum + trip.capacity, 0);
  const seatsBooked = input.trips.reduce((sum, trip) => sum + trip.activeBookings, 0);
  const waiverComplete = input.trips.reduce((sum, trip) => sum + trip.waiverComplete, 0);
  const atCapacityTrips = input.trips.filter(
    (trip) => trip.capacity > 0 && trip.activeBookings >= trip.capacity,
  ).length;

  return {
    tripCount: input.trips.length,
    seatsOffered,
    seatsBooked,
    // updateTrip (CR-006) now refuses to cut capacity below the booking
    // count, so this shouldn't happen in practice — the cap is defensive
    // insurance for the fill-rate contract [0, 1], matching the per-trip
    // rate, which already caps the same way.
    fillRate: seatsOffered > 0 ? Math.min(1, seatsBooked / seatsOffered) : null,
    atCapacityTrips,
    revenueCents: input.revenueCents,
    taxCents: input.taxCents,
    importedPaymentCents: input.importedPaymentCents,
    importedRefundCents: input.importedRefundCents,
    importedFinancialRecordCount: input.importedFinancialRecordCount,
    tipsCents: input.tipsCents,
    tipCount: input.tipCount,
    waiverComplete,
    waiverOutstanding: Math.max(0, seatsBooked - waiverComplete),
    waiverCompletion: seatsBooked > 0 ? waiverComplete / seatsBooked : null,
  };
}

/** "82%" for a ratio in [0, 1]; an em dash when there is nothing to measure. */
export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/**
 * A monthly revenue headline reads in whole major units — "$5,789", not
 * "$5,789.00". The trailing minor units are noise on a KPI and monthly totals
 * are whole units anyway. Falls back to `formatMoneyCents` shape (grouping,
 * symbol), just without the fraction.
 *
 * The currency is a parameter and never a lookup: this is `src/lib`, so the
 * caller — which has the shop row — decides (docs ADR 20260731-shop-currency).
 * The divisor comes from that currency via `minorToMajor`, not a literal 100,
 * or a ¥580,000 month would headline as ¥5,800.
 */
export function formatReportMoney(cents: number, currency = "usd", locale = "en-US"): string {
  return cachedFormatter("num", Intl.NumberFormat, locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(minorToMajor(cents, currency));
}

/**
 * A trip's fill as a ratio in [0, 1], capped at 1 (a manual over-book never
 * reads as more than full). Null when the trip offered no seats.
 */
export function tripFillRate(trip: Pick<ReportTrip, "capacity" | "activeBookings">): number | null {
  if (trip.capacity <= 0) return null;
  return Math.min(1, trip.activeBookings / trip.capacity);
}

/**
 * Which prior month a headline card compares against (issue #700). The
 * report page decides this once, off the same `floorMonth` it already
 * computes for the month picker — the earliest month this shop could
 * possibly have anything to report on — never off whether the fetched month
 * happens to be all zeroes, because a genuinely quiet month a shop *did* run
 * is a real baseline and a month before the shop existed is not.
 */
export type ComparisonBaselineKind = "yearAgo" | "previousMonth";

/**
 * One metric's comparison against a baseline month — bookings, revenue,
 * tips. `percentChange` is null below `smallBaseThreshold`: "2 bookings to 3"
 * is not "+50% growth", and a report that says so is one an owner stops
 * trusting (issue #700). The caller shows both raw numbers instead.
 */
export type MetricComparison = {
  current: number;
  baseline: number;
  percentChange: number | null;
};

/** Below this baseline, a percent change reads as noise rather than a trend. */
export const COUNT_SMALL_BASE = 10;

export function compareMetric(
  current: number,
  baseline: number,
  smallBaseThreshold: number,
): MetricComparison {
  const percentChange =
    baseline >= smallBaseThreshold ? Math.round(((current - baseline) / baseline) * 100) : null;
  return { current, baseline, percentChange };
}

/**
 * A ratio comparison (seat fill, waiver completion) in percentage POINTS,
 * never a relative "percent change of a percent" — the same small-base trap
 * `compareMetric`'s threshold exists to avoid, except a percent-of-a-percent
 * (10% to 15% read as "+50%") is misleading at every base, not only a small
 * one. Null when either side has nothing to measure.
 */
export type RatioComparison = {
  current: number | null;
  baseline: number | null;
  pointsChange: number | null;
};

export function compareRatio(current: number | null, baseline: number | null): RatioComparison {
  return {
    current,
    baseline,
    pointsChange:
      current !== null && baseline !== null ? Math.round((current - baseline) * 100) : null,
  };
}

export type MonthComparison = {
  kind: ComparisonBaselineKind;
  revenueCents: MetricComparison;
  tipsCents: MetricComparison;
  seatsBooked: MetricComparison;
  fillRate: RatioComparison;
  waiverCompletion: RatioComparison;
};

/**
 * Every headline card's comparison against one baseline month, computed in
 * one pass so the page never re-derives the small-base thresholds per card.
 *
 * Revenue and tips ride the *same* small-base signal bookings already use —
 * `baseline.seatsBooked` — rather than a second, money-shaped magic number.
 * A dollar floor cannot mean the same thing across every shop's own scale (a
 * single-boat operation's real month and a resort's are different orders of
 * magnitude), but "did this month have next to no bookings" does: a shop's
 * founding month reading $165 against a thriving $7,479 a year later is not
 * "+4433% growth", it is a month that barely happened yet, and the low
 * booking count is the honest reason why — the same reason the bookings
 * card itself would suppress its own percent for the identical baseline.
 */
export function compareMonthlyReports(
  kind: ComparisonBaselineKind,
  current: MonthlyReport,
  baseline: MonthlyReport,
  currency: string,
): MonthComparison {
  // `Infinity` never clears `baseline >= smallBaseThreshold` (short of an
  // infinite baseline), so a thinly-booked baseline month suppresses the
  // money percent exactly like a small count does; `0` always clears it
  // once there was real activity, so a genuine seasonal swing still shows —
  // seasonality is the whole point of this feature, not noise to hide.
  const moneyThreshold = baseline.seatsBooked >= COUNT_SMALL_BASE ? 0 : Number.POSITIVE_INFINITY;
  return {
    kind,
    revenueCents: compareMetric(
      minorToMajor(current.revenueCents, currency),
      minorToMajor(baseline.revenueCents, currency),
      moneyThreshold,
    ),
    tipsCents: compareMetric(
      minorToMajor(current.tipsCents, currency),
      minorToMajor(baseline.tipsCents, currency),
      moneyThreshold,
    ),
    seatsBooked: compareMetric(current.seatsBooked, baseline.seatsBooked, COUNT_SMALL_BASE),
    fillRate: compareRatio(current.fillRate, baseline.fillRate),
    waiverCompletion: compareRatio(current.waiverCompletion, baseline.waiverCompletion),
  };
}

/** "+12%" / "−8%" — signed, never a bare "12%" that could read as a level rather than a change. */
export function formatPercentChange(percentChange: number): string {
  return `${percentChange > 0 ? "+" : ""}${percentChange}%`;
}

/** "+6pp" / "−6pp" — a percentage-POINT delta, deliberately not styled as `formatPercentChange`'s relative change so the two are never confused reading down a page of cards. */
export function formatPointsChange(pointsChange: number): string {
  return `${pointsChange > 0 ? "+" : ""}${pointsChange}pp`;
}
