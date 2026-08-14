import { type CalendarDate, calendarDaysBetween } from "./calendar-date";

/**
 * Turning a pile of "could you run something on the 12th?" into the question a
 * shop actually asks: is there a boat's worth of people who could make one day?
 *
 * Three date fields do not group themselves, so the rules are stated once here
 * and nowhere else (the staff list at /shop/<shop>/requests renders what this
 * returns, and adds nothing):
 *
 * - **One group per calendar date.** A group exists for every date some request
 *   actually named — never a date invented to fill a gap.
 * - **A request appears in the group for its preferred date *and* in the group
 *   for its alternate.** A shop deciding whether to put a boat on the 12th
 *   wants everyone who could make the 12th, not only those who named it first.
 *   So a group's headline count is "people who could make this date", which is
 *   what a boat is counted against, and `firmCount` is the part of it that
 *   asked for this day before any other — enough to render a second choice in a
 *   lighter weight, so "3, one of them a fallback" cannot read as three firm
 *   asks.
 * - **A flexible request joins every group near one of its own dates** rather
 *   than getting a bucket of its own. A bucket labelled "flexible" is a list
 *   nobody schedules from.
 * - **Nothing is counted twice inside one group.** A request that names the
 *   12th and is also flexible around it is one person on the 12th, and the
 *   strongest claim it has on that day is the one recorded.
 * - **A request with no date at all is not forced into a group.** It sits in
 *   `undated`, which is where the prose a date field cannot hold ends up.
 *
 * Framework-free and storage-free: it takes whatever row shape the caller has,
 * as long as the dates can be read off it.
 */

/** How near a named date a flexible request will still travel. */
export const FLEXIBLE_WINDOW_DAYS = 3;

/** The only three fields grouping reads. */
export type DateRequestDates = {
  preferredDate: CalendarDate | null;
  alternateDate: CalendarDate | null;
  dateFlexible: boolean;
};

/**
 * Why a request is in a group — strongest first, and the order entries render
 * in. `nearby` is a flexible request that named a different day close to this
 * one; it is in the count because it can make the date, and marked because it
 * did not ask for it.
 */
export type DateRequestMatch = "preferred" | "alternate" | "nearby";

export type DateRequestEntry<T> = {
  request: T;
  match: DateRequestMatch;
};

export type DateRequestGroup<T> = {
  date: CalendarDate;
  entries: DateRequestEntry<T>[];
  /** People who could make this date — `entries.length`, named for what it means. */
  count: number;
  /** How many of them asked for this day first. */
  firmCount: number;
};

export type GroupedDateRequests<T> = {
  /** One group per named date, earliest first. */
  groups: DateRequestGroup<T>[];
  /** Requests that named no date at all, in the order they arrived. */
  undated: T[];
};

const MATCH_ORDER: Record<DateRequestMatch, number> = { preferred: 0, alternate: 1, nearby: 2 };

/** The dates one request actually named, in preference order, without repeats. */
function namedDates(dates: DateRequestDates): CalendarDate[] {
  const named: CalendarDate[] = [];
  for (const date of [dates.preferredDate, dates.alternateDate]) {
    if (date && !named.includes(date)) named.push(date);
  }
  return named;
}

/**
 * How this request relates to `date`, or null when it does not — the
 * precedence that keeps a request from being counted twice in one group.
 */
function matchFor(dates: DateRequestDates, date: CalendarDate): DateRequestMatch | null {
  if (dates.preferredDate === date) return "preferred";
  if (dates.alternateDate === date) return "alternate";
  if (!dates.dateFlexible) return null;
  const near = namedDates(dates).some(
    (named) => Math.abs(calendarDaysBetween(named, date)) <= FLEXIBLE_WINDOW_DAYS,
  );
  return near ? "nearby" : null;
}

/**
 * Groups requests by the dates they name.
 *
 * `datesOf` reads the three fields off whatever row shape the caller holds, so
 * this stays free of any particular query's column names.
 */
export function groupDateRequests<T>(
  requests: readonly T[],
  datesOf: (request: T) => DateRequestDates,
): GroupedDateRequests<T> {
  const dated: { request: T; dates: DateRequestDates }[] = [];
  const undated: T[] = [];
  const groupDates = new Set<CalendarDate>();

  for (const request of requests) {
    const dates = datesOf(request);
    const named = namedDates(dates);
    if (named.length === 0) {
      undated.push(request);
      continue;
    }
    dated.push({ request, dates });
    for (const date of named) groupDates.add(date);
  }

  const groups = [...groupDates].sort().map((date) => {
    const entries: DateRequestEntry<T>[] = [];
    for (const { request, dates } of dated) {
      const match = matchFor(dates, date);
      if (match) entries.push({ request, match });
    }
    // Firm asks first, then fallbacks, then the flexible neighbours — stable
    // within each, so the order rows arrived in survives.
    entries.sort((a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match]);
    return {
      date,
      entries,
      count: entries.length,
      firmCount: entries.filter((entry) => entry.match === "preferred").length,
    };
  });

  return { groups, undated };
}
