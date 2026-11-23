import { isoDate, type MonthRef, monthLabel } from "@/lib/calendar";
import { type CalendarDate, shiftCalendarDate } from "@/lib/calendar-date";
import { cachedFormatter } from "@/lib/intl-cache";

/** One square of the month grid: a day of the month, or a blank before the 1st. */
export type MonthGridCell = {
  dayKey: string;
  day: number;
  /** Departures that day with a seat left. */
  withRoom: number;
  /** Departures that day, full or not. */
  total: number;
};

/**
 * **The month as weeks of days**, each day saying how many boats have room.
 *
 * A day with no departure is blank (`total` 0), a day whose every boat is full says Full
 * (`total` > 0, `withRoom` 0). Days are keyed by the shop-local calendar day the caller passes in
 * (`dayKeyOf`), never by UTC, so a 7 PM night dive lands on its own evening.
 * `weekStartsOn` is 0 for Sunday, 1 for Monday.
 */
export function monthGridWeeks(
  month: MonthRef,
  departures: readonly { startsAt: Date; capacity: number; booked: number }[],
  dayKeyOf: (date: Date) => string,
  weekStartsOn: 0 | 1,
): (MonthGridCell | null)[][] {
  const byDay = new Map<string, { withRoom: number; total: number }>();
  for (const trip of departures) {
    const key = dayKeyOf(trip.startsAt);
    const entry = byDay.get(key) ?? { withRoom: 0, total: 0 };
    entry.total += 1;
    if (trip.booked < trip.capacity) entry.withRoom += 1;
    byDay.set(key, entry);
  }
  const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;
  const cells: (MonthGridCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const dayKey = isoDate(month.year, month.month, day);
    cells.push({ dayKey, day, ...(byDay.get(dayKey) ?? { withRoom: 0, total: 0 }) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (MonthGridCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The week opens on Sunday or Monday, as the reader's locale has it. */
export function weekStartsOnFor(locale: string): 0 | 1 {
  const info = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  };
  const firstDay = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
  return firstDay === 1 ? 1 : 0;
}

/** Seven short weekday names in grid order, in the reader's language. */
export function monthGridWeekdays(locale: string, weekStartsOn: 0 | 1): string[] {
  const format = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  // 2026-11-01 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2026, 10, 1 + ((i + weekStartsOn) % 7)))),
  );
}

/** How many weeks the grid that starts on this week draws. */
export const WINDOW_WEEKS = 5;

/**
 * **The grid that starts on this week** (#4934): the week holding today, then on for five weeks
 * across whatever month boundary falls in them. Days before today are in the first row and stay
 * blank. `first` and `last` are the months the grid draws, so a label can name both.
 * `today` is the shop-local calendar day the caller passes in, never read from a clock here.
 */
export type MonthWindow = {
  start: CalendarDate;
  weeks: number;
  first: MonthRef;
  last: MonthRef;
};

export function currentWeekWindow(
  today: CalendarDate,
  weekStartsOn: 0 | 1,
  weeks: number = WINDOW_WEEKS,
): MonthWindow {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const start = shiftCalendarDate(today, -((weekday - weekStartsOn + 7) % 7));
  const monthOf = (date: CalendarDate): MonthRef => {
    const [y, m] = date.split("-").map(Number);
    return { year: y, month: m };
  };
  return {
    start,
    weeks,
    first: monthOf(start),
    last: monthOf(shiftCalendarDate(start, weeks * 7 - 1)),
  };
}

/** The window as weeks of days, every square a real day, each saying how many boats have room. */
export function windowGridWeeks(
  window: MonthWindow,
  departures: readonly { startsAt: Date; capacity: number; booked: number }[],
  dayKeyOf: (date: Date) => string,
): MonthGridCell[][] {
  const byDay = new Map<string, { withRoom: number; total: number }>();
  for (const trip of departures) {
    const key = dayKeyOf(trip.startsAt);
    const entry = byDay.get(key) ?? { withRoom: 0, total: 0 };
    entry.total += 1;
    if (trip.booked < trip.capacity) entry.withRoom += 1;
    byDay.set(key, entry);
  }
  return Array.from({ length: window.weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, offset) => {
      const dayKey = shiftCalendarDate(window.start, week * 7 + offset);
      return {
        dayKey,
        day: Number(dayKey.slice(8)),
        ...(byDay.get(dayKey) ?? { withRoom: 0, total: 0 }),
      };
    }),
  );
}

/** "November – December 2026", or "November 2026" when the grid draws one month. */
export function monthSpanLabel(first: MonthRef, last: MonthRef, locale: string): string {
  if (first.year === last.year && first.month === last.month) return monthLabel(first, locale);
  const format = cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.formatRange(
    new Date(Date.UTC(first.year, first.month - 1, 1)),
    new Date(Date.UTC(last.year, last.month - 1, 1)),
  );
}
