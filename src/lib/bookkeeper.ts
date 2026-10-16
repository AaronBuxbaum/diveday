import { addMonths, type MonthRef, monthKey } from "@/lib/calendar";
import { utcToWallTime } from "@/lib/zoned";

/**
 * **The bookkeeper's month-end email, as arithmetic** (fifth loop, item 35;
 * ADR 20261016-bookkeeper-month-end-email).
 */

/**
 * Daily at 13:09 UTC on the 2nd and 3rd. In every zone from UTC-12 to
 * UTC+10 that is some hour of the shop's own 2nd, and from UTC+11 east of
 * the 3rd; the second day is the retry for a send that failed on the first.
 */
export const BOOKKEEPER_CRON_CRONTAB = "9 13 2,3 * *";

/**
 * The month whose files are due now, or null. From the shop's own 2nd, last
 * month is due until it has been sent (`sentMonth`, `YYYY-MM`); on the 1st,
 * nothing is, since the month only just closed and a late booking or refund
 * may still land on it overnight.
 */
export function bookkeeperMonthDue(
  now: Date,
  timeZone: string,
  sentMonth: string | null,
): MonthRef | null {
  const wall = utcToWallTime(now, timeZone);
  if (wall.day < 2) return null;
  const due = addMonths({ year: wall.year, month: wall.month }, -1);
  return sentMonth !== null && sentMonth >= monthKey(due) ? null : due;
}

/**
 * The month an address set now counts as already sent: the one due today.
 * A bookkeeper added on the 20th hears first on the next 2nd, about the month
 * then closing, rather than at once about a month nobody asked them for.
 */
export function bookkeeperMonthOnSet(now: Date, timeZone: string): string {
  const wall = utcToWallTime(now, timeZone);
  const closed = addMonths({ year: wall.year, month: wall.month }, wall.day < 2 ? -2 : -1);
  return monthKey(closed);
}

/** An address a person typed, normalized, or null when it is not one. */
export function bookkeeperAddress(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  return /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/.test(trimmed)
    ? trimmed
    : null;
}
