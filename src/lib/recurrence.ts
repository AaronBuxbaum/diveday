/**
 * Recurring-trip cadence math, framework- and database-free. An owner schedules
 * one trip and asks it to repeat ("every Monday and Thursday, indefinitely");
 * this turns that wish into an explicit list of dated occurrences the query
 * layer materializes as independent trips
 * (docs/architecture/decisions/20260810-open-ended-recurring-trips.md,
 * amending 20260719-recurring-trip-series).
 *
 * Two things changed from the first slice, and both live here:
 *
 * - **A cadence week fires on a *set* of weekdays**, not on whichever weekday
 *   the first date happened to be. "Monday and Thursday" is one series, and
 *   "every day" is the same machinery with all seven days selected — the model
 *   iCalendar has used for thirty years (`FREQ=WEEKLY;BYDAY=MO,TH`), so there
 *   is no separate daily frequency to keep in step.
 * - **A series need not end.** Occurrences are generated for a *window* rather
 *   than counted out to a fixed total, so an open-ended series is materialized
 *   as far ahead as `SERIES_HORIZON_DAYS` and rolled forward from there. The
 *   generator is a pure function of (anchor, pattern, window), which is what
 *   makes rolling it forward idempotent: re-running it over a window that is
 *   already on the board proposes exactly the dates it proposed last time, and
 *   the caller drops the ones it already has.
 *
 * Occurrences are computed as shop-local calendar dates and only turned into
 * UTC instants by the caller (via `src/lib/zoned.ts`), by shifting a template
 * departure by whole days. Shifting whole days at the wall-clock level keeps
 * the local departure time constant across a daylight-saving change — a 7:30
 * Saturday charter stays 7:30 even when the UTC offset moves under it.
 */

import {
  type CalendarDate,
  calendarDateWeekday,
  calendarDaysBetween,
  shiftCalendarDate,
} from "./calendar-date";
import type { WallTime } from "./zoned";

/**
 * Still one frequency: a weekday set plus a week interval expresses daily,
 * weekly, and every-N-weeks alike, so a second enum value would only be a
 * second way to say the same thing (and a second thing to keep in step).
 */
export type TripRecurrenceFrequency = "weekly";

export const MIN_INTERVAL_WEEKS = 1;
export const MAX_INTERVAL_WEEKS = 8;

/**
 * How far ahead a series is put on the board. Not a limit on the series — an
 * open-ended one has no total — but the width of the materialized window that
 * the horizon roll keeps full (`rollSeriesForward` in `src/db/trips-series.ts`).
 *
 * 120 days is chosen against what a diver can act on: the public schedule and
 * the booking page show real, bookable departures, and a shop that takes
 * deposits four months out is already unusual. Widening it costs rows and
 * nothing else; the generator is windowed, so nothing here assumes the number.
 */
export const SERIES_HORIZON_DAYS = 120;

/**
 * A hard stop on how many dates one generation pass may propose. Not a product
 * limit — the window bounds that — but a runaway guard: a caller that passes a
 * malformed window must fail loudly-and-small rather than materialize a decade
 * of Tuesdays inside one transaction. A daily series across the horizon needs
 * `SERIES_HORIZON_DAYS` of them, so this sits comfortably above the real cap.
 */
export const MAX_OCCURRENCES_PER_ROLL = 400;

/**
 * Which days of the week a cadence week fires on, as a bitmask: bit 0 is
 * Sunday through bit 6 is Saturday, matching `Date#getUTCDay` so no lookup
 * table sits between the two.
 *
 * A bitmask rather than an array column because it is one integer to store,
 * compare, and validate, and because "is Thursday in this set" is the only
 * question anything ever asks of it. It is a code, not a word: rendering it
 * as "Mon & Thu" is the surface's job, in the reader's own locale.
 */
export type WeekdaySet = number;

/**
 * Stable machine codes for the weekdays, Sunday first — the iCalendar
 * abbreviations, lowercased. Codes, not words: they exist so a CSV export reads
 * "mon,thu" instead of the bitmask `18`, and they never change with the
 * reader's language (anything a person reads *on screen* comes from `Intl`, via
 * `weekdayNames` in src/lib/format.ts).
 */
export const WEEKDAY_EXPORT_CODES = ["su", "mo", "tu", "we", "th", "fr", "sa"] as const;

/** Every day of the week — what "daily" is, expressed in the one model. */
export const EVERY_WEEKDAY: WeekdaySet = 0b111_1111;

/** The bit standing for one weekday, 0 = Sunday … 6 = Saturday. */
export function weekdayBit(weekday: number): number {
  return 1 << weekday;
}

/** A weekday set from a list of day numbers; unknown days are ignored. */
export function weekdaySetFrom(weekdays: Iterable<number>): WeekdaySet {
  let set = 0;
  for (const day of weekdays) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) set |= weekdayBit(day);
  }
  return set;
}

/** The days in a set, ascending from Sunday — for rendering and for tests. */
export function weekdaysIn(set: WeekdaySet): number[] {
  const days = [];
  for (let day = 0; day <= 6; day += 1) if (set & weekdayBit(day)) days.push(day);
  return days;
}

/** True when the set fires on the given weekday. */
export function weekdaySetHas(set: WeekdaySet, weekday: number): boolean {
  return (set & weekdayBit(weekday)) !== 0;
}

/** A set is usable only if it is an integer naming at least one real weekday. */
export function isValidWeekdaySet(set: WeekdaySet): boolean {
  return Number.isInteger(set) && set > 0 && set <= EVERY_WEEKDAY;
}

/**
 * The cadence itself: which weekdays, how many weeks apart. The phase — *which*
 * weeks count — comes from the series' anchor date, not from here, so a pattern
 * is comparable and renderable on its own.
 */
export type WeeklyPattern = {
  /** Weeks between firing weeks: 1 for every week, 2 for every other week. */
  intervalWeeks: number;
  weekdays: WeekdaySet;
};

/** True when the pattern is inside the supported bounds. */
export function isValidWeeklyPattern(pattern: WeeklyPattern): boolean {
  return (
    Number.isInteger(pattern.intervalWeeks) &&
    pattern.intervalWeeks >= MIN_INTERVAL_WEEKS &&
    pattern.intervalWeeks <= MAX_INTERVAL_WEEKS &&
    isValidWeekdaySet(pattern.weekdays)
  );
}

/** The Sunday that opens the week a date sits in — the phase reference below. */
function weekStart(date: CalendarDate): CalendarDate {
  return shiftCalendarDate(date, -calendarDateWeekday(date));
}

export type OccurrenceWindow = {
  /**
   * The date the cadence's weeks are counted from. It is not necessarily an
   * occurrence: a shop that starts a Mon+Thu series on a Wednesday gets its
   * first departure that Thursday, and the Wednesday only sets the phase.
   */
  anchorDate: CalendarDate;
  pattern: WeeklyPattern;
  /** Inclusive window start; dates before `anchorDate` are never proposed. */
  from: CalendarDate;
  /** Inclusive window end. */
  through: CalendarDate;
  /** Last date the series may ever fire on; null/undefined for an open-ended one. */
  endsOn?: CalendarDate | null;
};

/**
 * Every date the series fires on inside a window, in chronological order.
 *
 * Pure and total: the same window always yields the same dates, which is what
 * lets a horizon roll re-ask "what should be on the board through May?" every
 * night and simply skip what already is. Returns an empty list when the window
 * is empty or closed by `endsOn`, and `null` only when the pattern itself is
 * unusable — a caller must never quietly generate nothing because it passed a
 * malformed cadence.
 *
 * Walks day by day rather than jumping week to week: the window is bounded by
 * `SERIES_HORIZON_DAYS` at every call site, the arithmetic stays obvious at a
 * glance, and there is no clever stride to get wrong at a month boundary.
 */
export function seriesOccurrenceDates(window: OccurrenceWindow): CalendarDate[] | null {
  if (!isValidWeeklyPattern(window.pattern)) return null;
  const start = window.from > window.anchorDate ? window.from : window.anchorDate;
  const last = window.endsOn && window.endsOn < window.through ? window.endsOn : window.through;
  if (start > last) return [];

  const phaseFrom = weekStart(window.anchorDate);
  const dates: CalendarDate[] = [];
  for (
    let date = start;
    date <= last && dates.length < MAX_OCCURRENCES_PER_ROLL;
    date = shiftCalendarDate(date, 1)
  ) {
    if (!weekdaySetHas(window.pattern.weekdays, calendarDateWeekday(date))) continue;
    const weekIndex = Math.floor(calendarDaysBetween(phaseFrom, date) / 7);
    if (weekIndex % window.pattern.intervalWeeks !== 0) continue;
    dates.push(date);
  }
  return dates;
}

/**
 * Advance a wall-clock date by whole days, rolling months and years over
 * correctly. Pure calendar arithmetic on the date parts — no timezone is
 * involved, so `Date.UTC` is only a convenient integer calendar here, never an
 * instant. Hour and minute are preserved exactly.
 */
export function addDaysToWall(wall: WallTime, days: number): WallTime {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

/**
 * The cadence a `recurrenceSummary` reads as. A code, not a sentence —
 * `src/lib` never renders (see `recurrenceSummary`).
 */
export type RecurrenceCadence = "daily" | "weekly" | "everyNWeeks";

export type RecurrenceSummary = {
  cadence: RecurrenceCadence;
  /** Only meaningful when `cadence` is `"everyNWeeks"`. */
  intervalWeeks: number;
  /** Ascending day numbers, 0 = Sunday; empty is impossible for a valid series. */
  weekdays: number[];
  /** The last date the series may fire on, or null when it keeps going. */
  endsOn: CalendarDate | null;
};

/**
 * The staff-facing "Repeats every Mon & Thu · keeps going" one-liner, as codes
 * rather than prose: this module is framework- and database-free, so it has no
 * bundle to render into. The caller (a staff page, under `staffTranslator`)
 * resolves `cadence` through its own `Record<RecurrenceCadence, StaffMessageKey>`
 * and spells the weekdays for the request locale — see `SeriesSection.tsx`'s
 * `recurrenceSummaryText`.
 *
 * Deliberately carries no trip count. An open-ended series has no total, and
 * the count that *is* meaningful — how many dates are on the board right now —
 * is a live fact the caller already reads from the instances themselves, not
 * something the cadence can state.
 */
export function recurrenceSummary(series: {
  intervalWeeks: number;
  weekdays: WeekdaySet;
  endsOn?: CalendarDate | null;
}): RecurrenceSummary {
  const everyWeek = series.intervalWeeks === 1;
  return {
    cadence:
      everyWeek && series.weekdays === EVERY_WEEKDAY
        ? "daily"
        : everyWeek
          ? "weekly"
          : "everyNWeeks",
    intervalWeeks: series.intervalWeeks,
    weekdays: weekdaysIn(series.weekdays),
    endsOn: series.endsOn ?? null,
  };
}
