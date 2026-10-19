import { type CalendarDate, calendarDateWeekday, shiftCalendarDate } from "./calendar-date";
import { shopSeasonLabel } from "./season";

/**
 * **The shop's year, read from the days it already has** (ADR
 * 20260908-one-hand, decision 6, lever T).
 *
 * The year is the log read from far enough away: nothing is entered for it and
 * nothing is computed that the departures do not already say. This module is
 * the arithmetic half — the strip of days, the four figures, the sites in
 * order, and the two rules that keep the page honest about a year that is not
 * over ("since May" for a shop that opened mid-year, and a month still running
 * is never called the quietest). The reading itself is
 * `getShopYear` in `src/db/reporting.ts`; the words are the surface's.
 *
 * **A window of days, not a calendar year** (issues #2657 and #2664). The year
 * is the shop's season (`ShopSeason`, `src/lib/season.ts`), January 1 for a
 * shop that never moved it; the Money page's month reads the same summary
 * over its own 28 to 31 days.
 *
 * **A diver is a person** (issue #2663): every "divers" here counts distinct
 * people, as the home's season count does (`seasonScale`), so a regular who
 * dives every Saturday is one diver of the year and one of the month.
 *
 * **Money is not in this file.** The year page and the card both render from
 * `ShopYear`, and the card leaves the shop, so the
 * figure a shop would least like a stranger to read is not carried here at
 * all rather than carried and hidden downstream. The month page keeps its
 * money and is untouched.
 */

/** One shop-local day at sea, as the read returns it. */
export type ShopYearDay = {
  /** Shop-local `YYYY-MM-DD`. */
  day: CalendarDate;
  /** Departures that sailed that day. */
  boats: number;
  /** Different people aboard them: a diver on the morning and the night boat is one. */
  divers: number;
  /** Seats taken on them — the strip's numerator, so a second boat's seat still fills it. */
  aboard: number;
  /** Seats those departures offered — the strip's denominator. */
  seats: number;
};

/** How many days of the year one hull was at sea. */
export type ShopYearBoat = { name: string; days: number };

/**
 * A site and the times the shop dived it. A site the shop has since deleted
 * still counts — the year is what happened — but `live` is false and the row
 * is not a door, because the page behind it is gone.
 */
export type ShopYearSite = { siteId: string; name: string; times: number; live: boolean };

/** Everything the read hands the summary. */
export type ShopYearInput = {
  /** The calendar year the window starts in. */
  year: number;
  /** The window's first day: the season's start, or a month's first. */
  startsOn: CalendarDate;
  /** The window's last day. */
  endsOn: CalendarDate;
  /**
   * The first shop-local day the window draws — `startsOn`, or the shop's
   * first day at sea when that falls later inside it.
   */
  firstDay: CalendarDate;
  /** The last day drawn: today for the current window, `endsOn` for a past one. */
  lastDay: CalendarDate;
  /** True when `firstDay` is the shop's first day at sea rather than `startsOn`. */
  openedThisYear: boolean;
  /** Today in the shop's zone, so the strip can outline it and draw nothing after it. */
  today: CalendarDate;
  /** Different people who sailed in the window. Not the days' sum: one regular is one diver. */
  divers: number;
  /** Different people who sailed in each month of the window, keyed `YYYY-MM`. */
  monthDivers: { month: string; divers: number }[];
  days: ShopYearDay[];
  boats: ShopYearBoat[];
  sites: ShopYearSite[];
};

/**
 * How full the boats were that day, in four steps. Four rather than a
 * continuous ramp because the strip is read at 5px a square: a reader is
 * answering "was this a quiet week or a busy one", and a gradient at that size
 * says only "some colour".
 */
export type ShopYearFill = 0 | 1 | 2 | 3;

/** The two ratios between an empty boat and a full one. */
const HALF_FULL = 0.5;
const MOSTLY_FULL = 0.85;

/** One square of the strip. */
export type ShopYearCell = {
  /** Null for a padding square before the year's first day — nothing is drawn there. */
  day: CalendarDate | null;
  fill: ShopYearFill;
  divers: number;
  boats: number;
  /** True for today's square, which is outlined. */
  isToday: boolean;
};

export type ShopYearSummary = {
  year: number;
  /** "2026", or "2026–27" for a season that does not start on January 1. */
  label: string;
  startsOn: CalendarDate;
  endsOn: CalendarDate;
  firstDay: CalendarDate;
  lastDay: CalendarDate;
  /**
   * The month the year starts in when the shop opened inside it, 1-12 — the
   * "since May" rule. Null for a shop that was already sailing in the
   * window's first month.
   */
  sinceMonth: number | null;
  divers: number;
  /** Departures that sailed. */
  boatsOut: number;
  /** Days the shop was at sea. */
  daysAtSea: number;
  siteCount: number;
  boats: ShopYearBoat[];
  /** Sites in order, with the share of the busiest one's count for the bar. */
  sites: (ShopYearSite & { share: number })[];
  busiestDay: ShopYearDay | null;
  /** The quietest complete month, by divers. Null before a month has finished. */
  quietestMonth: { month: number; divers: number; boats: number } | null;
  /** Fifty-odd weeks of seven days, column by column. */
  strip: ShopYearCell[];
  /** False when nothing sailed: the page says so rather than drawing zeroes. */
  hasActivity: boolean;
};

function fillFor(day: ShopYearDay): ShopYearFill {
  if (day.boats === 0) return 0;
  if (day.seats <= 0) return 1;
  const ratio = day.aboard / day.seats;
  if (ratio < HALF_FULL) return 1;
  if (ratio < MOSTLY_FULL) return 2;
  return 3;
}

/** The month a shop-local calendar date falls in, 1-12. */
function monthOf(day: CalendarDate): number {
  return Number(day.slice(5, 7));
}

/**
 * Whether the month `key` (`YYYY-MM`) has run its full course inside the
 * window. A month still running has fewer days in it than it will have, so
 * calling it the quietest would be a fact about the calendar rather than about
 * the shop — every year page would name the current month for the first week
 * of it. A season that starts on the 15th cuts its first month the same way.
 */
function monthIsComplete(key: string, input: ShopYearInput): boolean {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return input.startsOn <= `${key}-01` && input.lastDay >= `${key}-${String(lastOfMonth)}`;
}

/**
 * The strip: one square per day from the Sunday on or before the year's first
 * day through the last day drawn, laid out column by column so seven rows read
 * as the days of the week. Squares before the first day are padding and draw
 * nothing; there are no squares after today at all, which is the promise the
 * board makes — the year is what happened, never what is booked.
 */
function buildStrip(input: ShopYearInput, byDay: Map<CalendarDate, ShopYearDay>): ShopYearCell[] {
  const lead = calendarDateWeekday(input.firstDay);
  let cursor = shiftCalendarDate(input.firstDay, -lead);
  const cells: ShopYearCell[] = [];
  // A year is 53 weeks at most, and the loop is bounded by the last day rather
  // than by a count so a shop that opened in November draws eight columns.
  while (cursor <= input.lastDay) {
    if (cursor < input.firstDay) {
      cells.push({ day: null, fill: 0, divers: 0, boats: 0, isToday: false });
    } else {
      const day = byDay.get(cursor);
      cells.push({
        day: cursor,
        fill: day ? fillFor(day) : 0,
        divers: day?.divers ?? 0,
        boats: day?.boats ?? 0,
        isToday: cursor === input.today,
      });
    }
    cursor = shiftCalendarDate(cursor, 1);
  }
  return cells;
}

/**
 * The year, summarized. Ties break on the earlier day and the earlier month,
 * so the same year always reads the same way.
 */
export function summarizeShopYear(input: ShopYearInput): ShopYearSummary {
  const byDay = new Map(input.days.map((day) => [day.day, day]));
  const boatsOut = input.days.reduce((total, day) => total + day.boats, 0);

  let busiestDay: ShopYearDay | null = null;
  for (const day of input.days) {
    if (day.boats === 0) continue;
    if (!busiestDay || day.divers > busiestDay.divers) busiestDay = day;
  }

  // Boats add up across days; divers do not, so each month's comes from the read.
  const monthDivers = new Map(input.monthDivers.map((row) => [row.month, row.divers]));
  const monthBoats = new Map<string, number>();
  for (const day of input.days) {
    if (day.boats === 0) continue;
    const key = day.day.slice(0, 7);
    monthBoats.set(key, (monthBoats.get(key) ?? 0) + day.boats);
  }
  let quietestMonth: { month: number; divers: number; boats: number } | null = null;
  for (const [key, boats] of [...monthBoats].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!monthIsComplete(key, input)) continue;
    const divers = monthDivers.get(key) ?? 0;
    if (!quietestMonth || divers < quietestMonth.divers) {
      quietestMonth = { month: Number(key.slice(5, 7)), divers, boats };
    }
  }

  const busiestSite = input.sites.reduce((most, site) => Math.max(most, site.times), 0);

  return {
    year: input.year,
    label: shopSeasonLabel(input),
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    firstDay: input.firstDay,
    lastDay: input.lastDay,
    sinceMonth:
      input.openedThisYear && input.firstDay.slice(0, 7) !== input.startsOn.slice(0, 7)
        ? monthOf(input.firstDay)
        : null,
    divers: input.divers,
    boatsOut,
    daysAtSea: input.days.filter((day) => day.boats > 0).length,
    siteCount: input.sites.length,
    boats: input.boats,
    sites: input.sites.map((site) => ({
      ...site,
      share: busiestSite > 0 ? site.times / busiestSite : 0,
    })),
    busiestDay,
    quietestMonth,
    strip: buildStrip(input, byDay),
    hasActivity: boatsOut > 0,
  };
}
