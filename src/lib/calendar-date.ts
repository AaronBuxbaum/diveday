import { cachedFormatter } from "./intl-cache";
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
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
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
 * The same calendar date `days` later (or earlier, for a negative count),
 * rolling months and years over correctly. Pure calendar arithmetic: a
 * `CalendarDate` has no instant in it, so `Date.UTC` here is a convenient
 * integer calendar and never a timezone conversion.
 */
export function shiftCalendarDate(date: CalendarDate, days: number): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);
  return toDateInputValue(utcToWallTimeParts(Date.UTC(year, month - 1, day + days)));
}

/** Whole calendar days from `from` to `to` — negative when `to` is earlier. */
export function calendarDaysBetween(from: CalendarDate, to: CalendarDate): number {
  const ms = calendarDateToUtcMidnight(to).getTime() - calendarDateToUtcMidnight(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Day of the week a calendar date falls on: 0 = Sunday … 6 = Saturday. */
export function calendarDateWeekday(date: CalendarDate): number {
  return calendarDateToUtcMidnight(date).getUTCDay();
}

/** Date parts of a UTC-calendar millisecond value, as the wall shape `toDateInputValue` reads. */
function utcToWallTimeParts(ms: number) {
  const shifted = new Date(ms);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
  };
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

/** One local day's worth of items, in the order the items arrived. */
export type LocalDayGroup<T> = { day: CalendarDate; items: T[] };

/**
 * Bucket instants into the shop's local calendar days, earliest day first.
 *
 * The day is resolved in the shop's own timezone, not the server's or the
 * viewer's: a 6am departure is on the day the boat leaves the dock, whoever is
 * reading. Returns keys (`CalendarDate`), never formatted words — the surface
 * decides how a day is spelled, for the request's locale.
 */
export function groupByLocalDay<T>(
  items: readonly T[],
  timeZone: string,
  instantOf: (item: T) => Date,
): LocalDayGroup<T>[] {
  const byDay = new Map<CalendarDate, T[]>();
  for (const item of items) {
    const day = calendarDateInTimezone(instantOf(item), timeZone);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(item);
    else byDay.set(day, [item]);
  }
  // `CalendarDate` sorts lexicographically in chronological order, so the day
  // keys need no parsing to order correctly.
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, dayItems]) => ({ day, items: dayItems }));
}
