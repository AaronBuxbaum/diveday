/**
 * Month math for month-keyed pages (the public schedule's month rail, the
 * monthly report). Pure and framework-free: a month is a `{year, month}` ref
 * with a stable `?month=` key, plus arithmetic and a localized heading. Trip
 * placement onto days is done by the caller with the shop-timezone helpers in
 * `zoned.ts` (a trip's day is its wall-clock date in the shop timezone), so
 * this file stays free of DB and timezone concerns and is exhaustively
 * unit-testable. The six-week grid builder that used to live here left with
 * the month-grid calendar it rendered — the public schedule now reads as a
 * day-grouped agenda instead of a grid of mostly-empty cells.
 */

import { cachedFormatter } from "./intl-cache";

export type MonthRef = { year: number; month: number }; // month is 1-12

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

/** Chronological order of two months: negative, zero, or positive. */
export function compareMonths(a: MonthRef, b: MonthRef): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/**
 * Pull a month back inside `[min, max]`. Either bound may be omitted, which
 * leaves that side unbounded. This is what stops a hand-typed or
 * bookmark-carried `?month=0001-01` from rendering a report for a month the
 * shop could not possibly have data for: the page clamps first, then queries.
 */
export function clampMonth(ref: MonthRef, min?: MonthRef | null, max?: MonthRef | null): MonthRef {
  if (min && compareMonths(ref, min) < 0) return min;
  if (max && compareMonths(ref, max) > 0) return max;
  return ref;
}

/** "July 2026" for the month rail and report headings. */
export function monthLabel(ref: MonthRef, locale = "en-US"): string {
  return cachedFormatter("dt", Intl.DateTimeFormat, locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ref.year, ref.month - 1, 1)));
}
