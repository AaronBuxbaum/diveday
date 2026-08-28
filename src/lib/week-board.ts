import {
  type CalendarDate,
  calendarDateWeekday,
  isValidCalendarDate,
  shiftCalendarDate,
} from "./calendar-date";

/**
 * The `?week=` grammar the staff board pages by, and the calendar arithmetic
 * that goes with it.
 *
 * Framework-free and instant-free on purpose: a week is a run of seven
 * `CalendarDate`s, which have no timezone in them. The shop's zone only enters
 * when a *departure* is bucketed into one of these days
 * (`calendarDateInTimezone`), or when a day is turned into the UTC instants
 * that bound a query.
 *
 * One spelling of the parameter, in one file, because a second surface reads
 * it: the staffing week (roadmap slice 9e) pages the same way over the same
 * dates. See ADR 20260827-clearwater-surface-language, decision 5.
 */

/** The query parameter that names a week — one spelling, every surface. */
export const WEEK_PARAM = "week";

/** How many days a week board shows. Seven columns, Monday first. */
export const WEEK_DAYS = 7;

/**
 * The Monday on or before `date`.
 *
 * Monday-first rather than Sunday-first because the week board's whole
 * question is "what does my week look like" and a weekend split across two
 * screens answers it badly — a dive shop's Saturday and Sunday are one thing.
 */
export function weekStartOf(date: CalendarDate): CalendarDate {
  // `calendarDateWeekday` is 0 = Sunday … 6 = Saturday; Monday-first offsets
  // are that shifted by one, with Sunday reaching back six days.
  return shiftCalendarDate(date, -((calendarDateWeekday(date) + 6) % 7));
}

/** The seven calendar dates of the week beginning `weekStart`, Monday first. */
export function weekDates(weekStart: CalendarDate): CalendarDate[] {
  return Array.from({ length: WEEK_DAYS }, (_, offset) => shiftCalendarDate(weekStart, offset));
}

/** The same weekday, `weeks` weeks later (or earlier, for a negative count). */
export function shiftWeek(weekStart: CalendarDate, weeks: number): CalendarDate {
  return shiftCalendarDate(weekStart, weeks * WEEK_DAYS);
}

/**
 * What week a `?week=` parameter means, defaulting to the one `today` is in.
 *
 * Deliberately total: a malformed, impossible ("2026-02-31") or missing value
 * resolves to this week rather than refusing the page, because the parameter
 * is a *reading* of the board and not a lookup — there is no wrong week to
 * land on, only a surprising one. A value that names some other day of a week
 * is normalised to that week's Monday, so `?week=2026-08-27` and
 * `?week=2026-08-24` are the same board and produce the same links.
 */
export function resolveWeekStart(param: string | undefined, today: CalendarDate): CalendarDate {
  return weekStartOf(param && isValidCalendarDate(param) ? param : today);
}
