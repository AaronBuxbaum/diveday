/**
 * Recurring-trip cadence math, framework- and database-free. An owner schedules
 * one trip and asks it to repeat ("every Saturday two-tank"); this turns that
 * wish into an explicit list of dated occurrences the query layer materializes
 * as independent trips (docs/architecture/decisions/20260719-recurring-trip-series.md).
 *
 * Occurrences are computed in the shop's wall-clock time and only converted to
 * UTC by the caller via `src/lib/zoned.ts`. Shifting whole days at the wall-clock
 * level keeps the local departure time constant across a daylight-saving change —
 * a 7:30 Saturday charter stays 7:30 even when the UTC offset moves under it.
 */

import type { WallTime } from "./zoned";

export type TripRecurrenceFrequency = "weekly";

/** A capped, deliberate horizon: a series is a season of charters, not an open calendar. */
export const MIN_SERIES_OCCURRENCES = 2;
export const MAX_SERIES_OCCURRENCES = 26;
export const MIN_INTERVAL_WEEKS = 1;
export const MAX_INTERVAL_WEEKS = 8;

export type WeeklyRecurrence = {
  frequency: "weekly";
  /** Weeks between instances: 1 for weekly, 2 for every other week. */
  intervalWeeks: number;
  /** Total number of dated instances to generate, including the first. */
  occurrenceCount: number;
};

const DAYS_PER_WEEK = 7;

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

/** True when the recurrence is inside the supported, capped bounds. */
export function isValidWeeklyRecurrence(recurrence: WeeklyRecurrence): boolean {
  const { intervalWeeks, occurrenceCount } = recurrence;
  return (
    Number.isInteger(intervalWeeks) &&
    intervalWeeks >= MIN_INTERVAL_WEEKS &&
    intervalWeeks <= MAX_INTERVAL_WEEKS &&
    Number.isInteger(occurrenceCount) &&
    occurrenceCount >= MIN_SERIES_OCCURRENCES &&
    occurrenceCount <= MAX_SERIES_OCCURRENCES
  );
}

/**
 * Expand a first trip's wall-clock start/end into the full list of occurrences,
 * each shifted by whole weeks. Returns `null` when the recurrence is out of
 * bounds so a caller cannot silently generate a runaway or empty series. The
 * first occurrence is always the original start/end, unchanged.
 */
export function weeklyOccurrences(
  first: { start: WallTime; end: WallTime },
  recurrence: WeeklyRecurrence,
): Array<{ start: WallTime; end: WallTime }> | null {
  if (!isValidWeeklyRecurrence(recurrence)) return null;
  const step = recurrence.intervalWeeks * DAYS_PER_WEEK;
  return Array.from({ length: recurrence.occurrenceCount }, (_, index) => {
    const offset = index * step;
    return {
      start: addDaysToWall(first.start, offset),
      end: addDaysToWall(first.end, offset),
    };
  });
}

/** Staff-facing one-liner, e.g. "Repeats weekly · 8 trips" or "Repeats every 2 weeks · 6 trips". */
export function recurrenceSummary(recurrence: WeeklyRecurrence): string {
  const cadence =
    recurrence.intervalWeeks === 1 ? "weekly" : `every ${recurrence.intervalWeeks} weeks`;
  const trips = recurrence.occurrenceCount === 1 ? "1 trip" : `${recurrence.occurrenceCount} trips`;
  return `Repeats ${cadence} · ${trips}`;
}
