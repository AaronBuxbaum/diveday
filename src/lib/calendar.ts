/**
 * Month-grid math for the schedule calendar. Pure and framework-free: it turns
 * a year+month into the six-week grid a calendar renders, plus the previous /
 * next month keys for navigation. Trip placement is done by the caller with the
 * shop-timezone helpers in `zoned.ts` (a trip's day is its wall-clock date in
 * the shop timezone), so this file stays free of DB and timezone concerns and
 * is exhaustively unit-testable.
 */

export type MonthRef = { year: number; month: number }; // month is 1-12

export type CalendarDay = {
  year: number;
  month: number; // 1-12
  day: number;
  /** "YYYY-MM-DD" — matches `toDateInputValue`, used to join trips onto days. */
  iso: string;
  /** False for the leading/trailing days that spill in from adjacent months. */
  inMonth: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "2026-07" — stable key for a month, used in the `?month=` search param. */
export function monthKey(ref: MonthRef): string {
  return `${ref.year}-${pad(ref.month)}`;
}

/** Parse "2026-07" back into a MonthRef, or null if malformed. */
export function parseMonthKey(value: string | undefined | null): MonthRef | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Shift a month by `delta` months, rolling the year over as needed. */
export function addMonths(ref: MonthRef, delta: number): MonthRef {
  const zeroBased = ref.month - 1 + delta;
  const year = ref.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  return { year, month: month + 1 };
}

/** "July 2026" for the calendar heading. */
export function monthLabel(ref: MonthRef, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ref.year, ref.month - 1, 1)));
}

/**
 * The six-week (42-day) grid for a month, Sunday-first, including the spill-in
 * days from the neighbouring months so every week is full. Uses UTC date
 * arithmetic purely for calendar counting — never for wall-clock conversion.
 */
export function buildCalendarWeeks(ref: MonthRef): CalendarDay[][] {
  const firstOfMonth = Date.UTC(ref.year, ref.month - 1, 1);
  const startWeekday = new Date(firstOfMonth).getUTCDay();
  const gridStart = firstOfMonth - startWeekday * 86_400_000;

  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const days: CalendarDay[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(gridStart + (week * 7 + dow) * 86_400_000);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      days.push({
        year,
        month,
        day,
        iso: isoDate(year, month, day),
        inMonth: month === ref.month && year === ref.year,
        weekday: d.getUTCDay(),
      });
    }
    weeks.push(days);
  }
  return weeks;
}
