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

/**
 * How long the bookkeeper's confirm link works (security review B1): the
 * shore contact's week (`SHORE_ALERT_CONFIRMATION_TTL_MS`).
 */
export const BOOKKEEPER_CONFIRMATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * An address a person typed, trimmed with its domain lowercased, or null when
 * it is not one. The mailbox before the `@` keeps its case: a server may
 * treat it as case-sensitive (security review N3).
 */
export function bookkeeperAddress(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!/^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/.test(trimmed)) {
    return null;
  }
  const at = trimmed.lastIndexOf("@");
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}
