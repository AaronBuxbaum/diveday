import { utcToWallTime, wallTimeToUtc } from "./zoned";

/**
 * **The season a shop counts in** — ADR 20260904-reef-all-the-way-down,
 * decision 2, Budget rule 3.
 *
 * The home says one fact of scale on the day it is true, and "your 400th
 * diver of the season" is a claim about a denominator. A dive shop's season
 * is not the calendar year in most of the world, so the shop chooses where it
 * starts and this is the arithmetic behind that choice. The default is
 * January 1, which is the calendar year and the ADR's own default.
 *
 * February is capped at the 28th rather than the 29th, here and in the table's
 * CHECK constraint. A season that began on a leap day would need a clamp in
 * every reader of it, and no shop's season starts on 29 February.
 */
export type SeasonStart = { month: number; day: number };

export const SEASON_START_DEFAULT: SeasonStart = { month: 1, day: 1 };

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Reads a month and a day off a form. Refuses exactly what the CHECK
 * constraints refuse, so the action and the table can never disagree about
 * what a season start is.
 */
export function parseSeasonStart(month: unknown, day: unknown): SeasonStart | null {
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > (DAYS_IN_MONTH[m - 1] as number)) return null;
  return { month: m, day: d };
}

/**
 * The most recent shop-local midnight on which the season began: this year's
 * anniversary if it has passed, last year's if it has not.
 *
 * Shop-local, not UTC. A season starting 1 May in Key Largo begins at 04:00Z,
 * and a count bounded by UTC midnight would hand the shop four hours of the
 * previous season on the day the answer matters most.
 */
export function seasonStartInstant(now: Date, timeZone: string, season: SeasonStart): Date {
  const wall = utcToWallTime(now, timeZone);
  const midnight = { month: season.month, day: season.day, hour: 0, minute: 0 };
  const thisYear = wallTimeToUtc({ ...midnight, year: wall.year }, timeZone);
  if (thisYear.getTime() <= now.getTime()) return thisYear;
  return wallTimeToUtc({ ...midnight, year: wall.year - 1 }, timeZone);
}
