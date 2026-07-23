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
 * waiver completion all live naturally on those trips; revenue is the money
 * actually collected on their bookings (booking_payments — the same paid/deposit
 * amounts that gate boarding). See docs ADR 20260723-owner-reporting.
 */

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
  /** Minor units collected (paid + deposit) on this month's trips' bookings. */
  revenueCents: number;
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
  /** Minor units collected on the month's trips. */
  revenueCents: number;
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
    // Capacity can be cut below the booking count (updateTrip doesn't re-check
    // the roster), which would push a raw ratio past 1; the contract is [0, 1],
    // and the per-trip rate already caps, so cap the aggregate too.
    fillRate: seatsOffered > 0 ? Math.min(1, seatsBooked / seatsOffered) : null,
    atCapacityTrips,
    revenueCents: input.revenueCents,
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
 * A monthly revenue headline reads as whole dollars — "$5,789", not
 * "$5,789.00". The trailing cents are noise on a KPI and monthly totals are
 * whole dollars anyway. Falls back to `formatMoneyCents` shape (grouping,
 * symbol), just without the fraction.
 */
export function formatReportMoney(cents: number, currency = "usd", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * A trip's fill as a ratio in [0, 1], capped at 1 (a manual over-book never
 * reads as more than full). Null when the trip offered no seats.
 */
export function tripFillRate(trip: Pick<ReportTrip, "capacity" | "activeBookings">): number | null {
  if (trip.capacity <= 0) return null;
  return Math.min(1, trip.activeBookings / trip.capacity);
}
