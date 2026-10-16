/**
 * **Booking lead time** (glossary; fifth loop, item 34): how many days before
 * a departure its seats were booked. Pure reading of the per-weekday figures
 * `bookingLeadTimes` (src/db/reporting.ts) returns.
 *
 * Quiet until there is history: a weekday says nothing until this many seats
 * stand behind it, so a new shop's three bookings never read as a pattern.
 */
export const LEAD_TIME_MIN_SEATS = 20;

/** How many weekdays Reports names, busiest first. */
export const LEAD_TIME_LINES = 3;

type LeadTimeRow = {
  isoWeekday: number;
  seats: number;
  medianDays: number;
  lastThreeDaysShare: number;
};

/** The weekdays worth a sentence: enough seats, busiest first, at most three. */
export function leadTimeLines<Row extends LeadTimeRow>(rows: readonly Row[]): Row[] {
  return rows
    .filter((row) => row.seats >= LEAD_TIME_MIN_SEATS)
    .sort((left, right) => right.seats - left.seats || left.isoWeekday - right.isoWeekday)
    .slice(0, LEAD_TIME_LINES);
}

/**
 * The one weekday a deal form asks about, or null while that weekday has too
 * little history to say anything.
 */
export function leadTimeForWeekday<Row extends LeadTimeRow>(
  rows: readonly Row[],
  isoWeekday: number,
): Row | null {
  const row = rows.find((candidate) => candidate.isoWeekday === isoWeekday);
  return row && row.seats >= LEAD_TIME_MIN_SEATS ? row : null;
}

/** A share as a whole percent, for the sentence. */
export function wholePercent(share: number): number {
  return Math.round(share * 100);
}
