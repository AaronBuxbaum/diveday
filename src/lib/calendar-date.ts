import { toDateInputValue, utcToWallTime } from "./zoned";

/**
 * A date with no time-of-day or timezone component — "2026-07-18". ISO
 * (`YYYY-MM-DD`) form, which sorts lexicographically in the same order it
 * sorts chronologically, so `a < b` / `a >= b` compare correctly as plain
 * strings without parsing.
 */
export type CalendarDate = string;

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a date that actually exists on the calendar — rejects
 * "2026-02-31" the same way it rejects "2026-13-01", not just malformed
 * shape (CR-009). Leap years are handled correctly via the JS calendar.
 */
export function isValidCalendarDate(value: string): value is CalendarDate {
  const match = CALENDAR_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** "Today" as a calendar date in a shop's local timezone, for expiry comparisons. */
export function calendarDateInTimezone(date: Date, timeZone: string): CalendarDate {
  return toDateInputValue(utcToWallTime(date, timeZone));
}

/**
 * Staff-facing display for a date-only value, e.g. "Jul 18, 2026" — no
 * time-of-day, no timezone conversion (there is none to do: `date` is
 * already a wall-clock calendar date, not an instant). Formats through UTC
 * so the server's own local timezone can never shift the displayed day.
 */
export function formatCalendarDate(date: CalendarDate, locale = "en-US"): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** A calendar date as a UTC-midnight instant — for a timestamp column that needs one. */
export function calendarDateToUtcMidnight(date: CalendarDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * A date-only expiry is valid through the end of its own local day: it has
 * not yet expired while today's shop-local date is on or before it, and
 * expires only once the shop's local calendar rolls past it (CR-009) — never
 * hours early in a negative UTC offset, never hours late in a positive one.
 */
export function isCalendarDateExpired(expiresOn: CalendarDate, todayLocal: CalendarDate): boolean {
  return expiresOn < todayLocal;
}
