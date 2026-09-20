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
 *   So a group's headline is the number of groups in the group. The entries
 *   still carry their match so a second choice or flexible neighbour can be
 *   rendered differently, without turning the group summary into a diver
 *   capacity estimate or a count of first choices.
 * - **It is printed whole in exactly one of them.** Every entry carries
 *   `homeDate`, the first date its request named; the staff list renders the
 *   full record there and a one-line reference in every other group it reaches.
 *   Five identical four-line bodies for one diver is the same lead five times,
 *   not five leads.
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
  /**
   * The one group this request's **full record** belongs under: the first date
   * it named (`preferredDate ?? alternateDate`).
   *
   * A request lands in every group it could make, which is the whole point of
   * the grouping — but printing it whole in each of them is the same lead said
   * five times. Every group where `homeDate` is not the group's own date shows
   * a one-line reference pointing here instead. Recorded rather than derived by
   * the page, because "which date does this request belong to" is the same
   * question `matchFor` already answers and it may only have one answer.
   */
  homeDate: CalendarDate;
};

export type DateRequestGroup<T> = {
  date: CalendarDate;
  entries: DateRequestEntry<T>[];
  /** Groups represented in this date group — `entries.length`, named for what it means. */
  groupCount: number;
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
 * Whether a request belongs beside a particular departure date. The booking
 * flow uses the same rules as the Requests page so a flexible request is not
 * shown for one surface and silently omitted from the other.
 */
export function dateRequestMatchFor(
  dates: DateRequestDates,
  date: CalendarDate,
): DateRequestMatch | null {
  return matchFor(dates, date);
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
      // `namedDates` is non-empty for everything in `dated`, so the first named
      // date always exists and always has a group of its own.
      const homeDate = namedDates(dates)[0];
      if (match && homeDate) entries.push({ request, match, homeDate });
    }
    // Firm asks first, then fallbacks, then the flexible neighbours — stable
    // within each, so the order rows arrived in survives.
    entries.sort((a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match]);
    return {
      date,
      entries,
      groupCount: entries.length,
    };
  });

  return { groups, undated };
}

/**
 * The schedule builder, opened on this day with these leads carried forward.
 *
 * The whole point of counting groups against a day: the builder opens on that
 * date with the full form already disclosed (ADR 20260806-one-trip-create-form)
 * and carries the requests forward as invitations, so "two groups could make
 * the 4th" ends in a departure on the 4th rather than a note somewhere.
 *
 * Here rather than beside the Requests page's own row, because the week's
 * "Asked for" section offers the same act (ADR 20260919-one-idea, slice 23f)
 * and two surfaces building this URL by hand is how one of them comes to open
 * the builder on the wrong day or drop the leads.
 */
export function addDepartureHref(
  shopSlug: string,
  date: CalendarDate,
  requestIds: readonly string[],
): string {
  const params = new URLSearchParams({
    add: "full",
    date,
    requests: requestIds.join(","),
  });
  return `/shop/${encodeURIComponent(shopSlug)}/schedule/board?${params.toString()}`;
}
