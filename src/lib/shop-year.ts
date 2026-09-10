import { type CalendarDate, calendarDateWeekday, shiftCalendarDate } from "./calendar-date";

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
 * **Money is not in this file.** The year page, the card and the homepage band
 * all render from `ShopYear`, and two of the three leave the shop, so the
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
  /** Divers aboard them. */
  divers: number;
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

/** One close-out the shop wrote, newest first on the page. */
export type ShopYearEntry = {
  day: CalendarDate;
  /** Who closed the day. */
  actor: string;
  divers: number;
  boats: number;
};

/** Everything the read hands the summary. */
export type ShopYearInput = {
  year: number;
  /**
   * The first shop-local day the year draws — January 1 of `year`, or the
   * shop's first day at sea when that falls later inside it.
   */
  firstDay: CalendarDate;
  /** The last day drawn: today for the current year, December 31 for a past one. */
  lastDay: CalendarDate;
  /** True when `firstDay` is the shop's first day at sea rather than January 1. */
  openedThisYear: boolean;
  /** Today in the shop's zone, so the strip can outline it and draw nothing after it. */
  today: CalendarDate;
  days: ShopYearDay[];
  boats: ShopYearBoat[];
  sites: ShopYearSite[];
  entries: ShopYearEntry[];
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
  firstDay: CalendarDate;
  lastDay: CalendarDate;
  /**
   * The month the year starts in when the shop opened inside it, 1-12 — the
   * "since May" rule. Null for a shop that was already sailing on January 1.
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
  entries: ShopYearEntry[];
  /** False when nothing sailed: the page says so rather than drawing zeroes. */
  hasActivity: boolean;
};

/**
 * **What the card is allowed to know** (security review, finding 2).
 *
 * The card leaves the shop — printed, mailed, and on DiveDay's homepage for a
 * shop that said yes — so it renders from a narrower thing than the page does.
 * `entries` is the difference: a close-out carries the name of the staff member
 * who wrote it, which belongs on the shop's own year page and nowhere a
 * stranger reads. Dropping it from the *type* means no future edit to the card
 * can print it by reaching one field further, and {@link shopYearCard} drops it
 * from the value as well, so it is not in the render input at runtime either.
 *
 * Everything that remains is a count, a date, or a name the shop publishes
 * anyway — its own, its boats', its sites'.
 */
export type ShopYearCard = Omit<ShopYearSummary, "entries">;

/** The year with the close-outs taken off, for the card's two routes. */
export function shopYearCard(year: ShopYearSummary): ShopYearCard {
  const { entries: _entries, ...card } = year;
  return card;
}

function fillFor(day: ShopYearDay): ShopYearFill {
  if (day.boats === 0) return 0;
  if (day.seats <= 0) return 1;
  const ratio = day.divers / day.seats;
  if (ratio < HALF_FULL) return 1;
  if (ratio < MOSTLY_FULL) return 2;
  return 3;
}

/** The month a shop-local calendar date falls in, 1-12. */
function monthOf(day: CalendarDate): number {
  return Number(day.slice(5, 7));
}

/**
 * Whether `month` has run its full course inside the window. A month still
 * running has fewer days in it than it will have, so calling it the quietest
 * would be a fact about the calendar rather than about the shop — every year
 * page would name the current month for the first week of it.
 */
function monthIsComplete(year: number, month: number, lastDay: CalendarDate): boolean {
  const lastOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastOfMonth).padStart(2, "0")}`;
  return lastDay >= end;
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
  const divers = input.days.reduce((total, day) => total + day.divers, 0);
  const boatsOut = input.days.reduce((total, day) => total + day.boats, 0);

  let busiestDay: ShopYearDay | null = null;
  for (const day of input.days) {
    if (day.boats === 0) continue;
    if (!busiestDay || day.divers > busiestDay.divers) busiestDay = day;
  }

  const months = new Map<number, { divers: number; boats: number }>();
  for (const day of input.days) {
    if (day.boats === 0) continue;
    const month = monthOf(day.day);
    const running = months.get(month) ?? { divers: 0, boats: 0 };
    months.set(month, { divers: running.divers + day.divers, boats: running.boats + day.boats });
  }
  let quietestMonth: { month: number; divers: number; boats: number } | null = null;
  for (const [month, totals] of [...months].sort((a, b) => a[0] - b[0])) {
    if (!monthIsComplete(input.year, month, input.lastDay)) continue;
    if (!quietestMonth || totals.divers < quietestMonth.divers) {
      quietestMonth = { month, divers: totals.divers, boats: totals.boats };
    }
  }

  const busiestSite = input.sites.reduce((most, site) => Math.max(most, site.times), 0);

  return {
    year: input.year,
    firstDay: input.firstDay,
    lastDay: input.lastDay,
    sinceMonth:
      input.openedThisYear && monthOf(input.firstDay) > 1 ? monthOf(input.firstDay) : null,
    divers,
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
    entries: input.entries,
    hasActivity: boatsOut > 0,
  };
}
