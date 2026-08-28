import {
  type CalendarDate,
  calendarDateWeekday,
  isValidCalendarDate,
  shiftCalendarDate,
} from "./calendar-date";

/**
 * The `?week=` grammar the staff board pages by, and the calendar arithmetic
 * that goes with it.
 *
 * Framework-free and instant-free on purpose: a week is a run of seven
 * `CalendarDate`s, which have no timezone in them. The shop's zone only enters
 * when a *departure* is bucketed into one of these days
 * (`calendarDateInTimezone`), or when a day is turned into the UTC instants
 * that bound a query.
 *
 * One spelling of the parameter, in one file, because a second surface reads
 * it: the staffing week (roadmap slice 9e) pages the same way over the same
 * dates. See ADR 20260827-clearwater-surface-language, decision 5.
 */

/** The query parameter that names a week — one spelling, every surface. */
export const WEEK_PARAM = "week";

/** How many days a week board shows. Seven columns, Monday first. */
export const WEEK_DAYS = 7;

/**
 * The Monday on or before `date`.
 *
 * Monday-first rather than Sunday-first because the week board's whole
 * question is "what does my week look like" and a weekend split across two
 * screens answers it badly — a dive shop's Saturday and Sunday are one thing.
 */
export function weekStartOf(date: CalendarDate): CalendarDate {
  // `calendarDateWeekday` is 0 = Sunday … 6 = Saturday; Monday-first offsets
  // are that shifted by one, with Sunday reaching back six days.
  return shiftCalendarDate(date, -((calendarDateWeekday(date) + 6) % 7));
}

/** The seven calendar dates of the week beginning `weekStart`, Monday first. */
export function weekDates(weekStart: CalendarDate): CalendarDate[] {
  return Array.from({ length: WEEK_DAYS }, (_, offset) => shiftCalendarDate(weekStart, offset));
}

/** The same weekday, `weeks` weeks later (or earlier, for a negative count). */
export function shiftWeek(weekStart: CalendarDate, weeks: number): CalendarDate {
  return shiftCalendarDate(weekStart, weeks * WEEK_DAYS);
}

/**
 * What week a `?week=` parameter means, defaulting to the one `today` is in.
 *
 * Deliberately total: a malformed, impossible ("2026-02-31") or missing value
 * resolves to this week rather than refusing the page, because the parameter
 * is a *reading* of the board and not a lookup — there is no wrong week to
 * land on, only a surprising one. A value that names some other day of a week
 * is normalised to that week's Monday, so `?week=2026-08-27` and
 * `?week=2026-08-24` are the same board and produce the same links.
 */
export function resolveWeekStart(param: string | undefined, today: CalendarDate): CalendarDate {
  return weekStartOf(param && isValidCalendarDate(param) ? param : today);
}

/**
 * The floor under "say a shared fact once". Below three departures a banner
 * claiming the whole week is unpriced says less than the two marks it
 * replaces, and on one departure it is the same sentence moved further from
 * the thing it is about.
 */
export const WEEK_SHARED_FACT_FLOOR = 3;

/** The little this gate needs to know about a departure. */
type PricedDeparture = { status: "upcoming" | "sailed"; priceCents: number | null };

/**
 * Whether *every* departure this week still has to sail is unpriced — the
 * grid's gate for collapsing seven warning marks into one line above it
 * (principle 9: a fact shared by every row belongs to the group, not to each
 * row).
 *
 * **It takes the whole board, days and spans, and not a list the caller
 * assembled.** A multi-day course comes back from `weekBoard()` as a span and
 * is deliberately never also dropped into the day cells it covers, so a gate
 * fed `days` alone reads a week whose only upcoming departures are two
 * unpriced courses as having nothing to say: no banner, and no mark on the
 * bars either, since they were never in the tally that decides whether a mark
 * is needed. The shop is told nothing at all, which is the one outcome this
 * exists to prevent — so the shape of the argument is the fix.
 *
 * A departure already home is excluded on both sides: it cannot be booked, so
 * its missing price is nobody's morning.
 */
export function weekIsWhollyUnpriced(board: {
  days: Record<CalendarDate, PricedDeparture[]>;
  spans: readonly PricedDeparture[];
}): boolean {
  const upcoming = [...Object.values(board.days).flat(), ...board.spans].filter(
    (departure) => departure.status === "upcoming",
  );
  return (
    upcoming.length >= WEEK_SHARED_FACT_FLOOR &&
    upcoming.every((departure) => departure.priceCents === null)
  );
}

/**
 * What a week cell says under its title, in the order it says it.
 *
 * **The site leads, because it is the half that differs.** Every title in a
 * column shares its prefix — "Dawn Two-Tank — Molasses Reef", "Morning
 * Two-Tank — Grecian Rocks" — and a ~150px column clips exactly the words
 * that tell one from the next, so the site is stated here where it survives
 * and the title is clamped to one line above it.
 *
 * **A full boat is a count, not a word.** "Full · 12 of 12" spends the
 * currency the grid's real warnings use on a fact the two numbers beside it
 * already carry (issue 758 — the same call the stream made when it retired
 * its own success pill).
 *
 * Every segment arrives already localised and already formatted for the shop's
 * zone; this decides only which ones there are and in what order, which is why
 * it can be a pure function with a test rather than four lines inside a page.
 */
export function weekEntryMeta(entry: {
  status: "upcoming" | "sailed";
  /** The word for a boat already home — its own state outranks everything. */
  sailedLabel: string;
  siteName: string | null;
  seats: string;
  price: string | null;
}): string {
  if (entry.status === "sailed") return [entry.sailedLabel, entry.seats].join(" · ");
  return [entry.siteName, entry.seats, entry.price].filter(Boolean).join(" · ");
}
