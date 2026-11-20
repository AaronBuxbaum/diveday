import { isoDate, type MonthRef } from "@/lib/calendar";
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
