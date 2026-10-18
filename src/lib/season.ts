import { type CalendarDate, shiftCalendarDate } from "./calendar-date";
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

/**
 * **The shop's year is its season** (issue #2657): the twelve months from the
 * shop's season start, as a window of shop-local days. The year page, its
 * card, Reports' year money and the shopfront's "Our year" all read this one
 * window, so the home's season count and the year page count over the same
 * days. A January-start shop's window is the calendar year.
 */
export type ShopSeason = {
  /** The calendar year the season starts in; what `?year=` names. */
  year: number;
  /** The season's first shop-local day. */
  startsOn: CalendarDate;
  /** Its last: the day before the next season starts. */
  endsOn: CalendarDate;
};

/** The season that starts in `year`. */
export function shopSeasonOf(year: number, season: SeasonStart): ShopSeason {
  const start = (y: number) =>
    `${String(y).padStart(4, "0")}-${String(season.month).padStart(2, "0")}-${String(season.day).padStart(2, "0")}`;
  // February is capped at the 28th (the table's CHECK), so every year has this day.
  return { year, startsOn: start(year), endsOn: shiftCalendarDate(start(year + 1), -1) };
}

/** The season `now` falls in, through {@link seasonStartInstant}. */
export function currentShopSeason(now: Date, timeZone: string, season: SeasonStart): ShopSeason {
  return shopSeasonOf(
    utcToWallTime(seasonStartInstant(now, timeZone, season), timeZone).year,
    season,
  );
}

/**
 * The season's name: "2026" when it is the calendar year, "2026–27" when it
 * starts anywhere else. Digits only, so it is not copy; the sentence around
 * it comes from the bundle.
 */
export function shopSeasonLabel(season: Pick<ShopSeason, "year" | "startsOn">): string {
  if (season.startsOn.endsWith("-01-01")) return String(season.year);
  return `${season.year}–${String((season.year + 1) % 100).padStart(2, "0")}`;
}
