/**
 * **The reef's calendar** — the shop's own year, in its own words (issue #1485).
 *
 * Lobster mini-season, a goliath grouper aggregation, turtle nesting, the
 * lionfish derby the shop runs every August. These are the weeks a Florida
 * shop plans its summer around, and every one of them is local: the dates move
 * by state rule and by species, the words that describe them are the shop's,
 * and a DiveDay-supplied catalog would be wrong for most of the coast and
 * insulting to the half of it that knows better. So the shop writes the name,
 * the days and the sentence, exactly as it writes a dive site's fit tone (ADR
 * 20260813-dive-site-briefings-are-the-shops-own-words), and DiveDay supplies
 * only the frame around them.
 *
 * The framework-free half: **when** a window is live, upcoming, or over. Codes
 * and calendar dates, never sentences.
 *
 * **A season has no instant in it.** "Lobster mini-season is the last
 * Wednesday and Thursday of July" is two calendar days, inclusive at both ends,
 * and nothing about it is a moment on a clock. So every date here is a
 * `CalendarDate` compared as a plain string, and the only timezone question in
 * the module is the one at its edge: *which day is it at the shop right now*,
 * which the caller answers with `calendarDateInTimezone(now, shop.timezone)`.
 * That is the honest place for the zone — a Key Largo shop's mini-season opens
 * when it is Wednesday in Key Largo, not when it is Wednesday in UTC.
 */

import type { CalendarDate } from "./calendar-date";
import { calendarDaysBetween, isValidCalendarDate } from "./calendar-date";

/** The longest a season's name may run; the same ceiling a lens name has. */
export const SEASON_EVENT_NAME_MAX = 60;

/** The longest the shop's own sentence about the season may run. */
export const SEASON_EVENT_NOTE_MAX = 280;

/**
 * How far ahead the board is reminded.
 *
 * A month, because that is the horizon a shop can still act on: putting boats
 * on the water for mini-season, hiring a second divemaster, or telling the
 * last-minute list a week is coming. A week's notice is a week the shop spends
 * apologising for a full boat, and a season named in January that nags from
 * January is a row nobody reads by March.
 */
export const SEASON_EVENT_REMINDER_DAYS = 30;

/** Where a window sits relative to the shop's own calendar day. */
export type SeasonEventState = "upcoming" | "live" | "over";

/** The window itself — the two columns every reader here needs, and nothing else. */
export type SeasonEventWindow = {
  startsOn: CalendarDate;
  /** Inclusive: a one-day derby is `startsOn === endsOn`. */
  endsOn: CalendarDate;
};

/**
 * Where a window sits on a given shop-local day.
 *
 * Both ends inclusive, which is the whole reason this is a function rather
 * than two comparisons at each call site: a two-day mini-season that stopped
 * being live at breakfast on its second morning is a bug a shop notices from
 * its own storefront, and it is the exact bug an exclusive `endsOn` produces.
 */
export function seasonEventState(window: SeasonEventWindow, today: CalendarDate): SeasonEventState {
  if (today < window.startsOn) return "upcoming";
  if (today > window.endsOn) return "over";
  return "live";
}

/** True while today is inside the window, both ends included. */
export function isSeasonEventLive(window: SeasonEventWindow, today: CalendarDate): boolean {
  return seasonEventState(window, today) === "live";
}

/**
 * Days until the window opens — negative once it has, so a caller that wants
 * "not yet" asks `seasonEventState` rather than reading a sign.
 */
export function daysUntilSeasonEvent(window: SeasonEventWindow, today: CalendarDate): number {
  return calendarDaysBetween(today, window.startsOn);
}

/**
 * **The month-out reminder** — true for a window that has not opened yet and
 * opens within `SEASON_EVENT_REMINDER_DAYS`.
 *
 * Deliberately silent once the season is live: by then the shop is standing in
 * it, and a queue row telling somebody about the week they are working is the
 * kind of notification that teaches people to skim past the queue.
 */
export function seasonEventNeedsReminder(
  window: SeasonEventWindow,
  today: CalendarDate,
  withinDays: number = SEASON_EVENT_REMINDER_DAYS,
): boolean {
  if (seasonEventState(window, today) !== "upcoming") return false;
  return daysUntilSeasonEvent(window, today) <= withinDays;
}

/**
 * The live windows, soonest to end first.
 *
 * Two seasons genuinely overlap — turtle nesting runs half the year and a
 * two-day mini-season sits inside it — so the order is what decides which one
 * the storefront band leads with, and the one about to end is the one a visitor
 * still has time to act on.
 */
export function liveSeasonEvents<T extends SeasonEventWindow>(
  events: readonly T[],
  today: CalendarDate,
): T[] {
  return events
    .filter((event) => isSeasonEventLive(event, today))
    .sort((a, b) => (a.endsOn < b.endsOn ? -1 : a.endsOn > b.endsOn ? 1 : 0));
}

/**
 * **The kind of day a departure on this date inherits**, or null when no live
 * season names one (issue #1492).
 *
 * `find`, deliberately not `[0]`. {@link liveSeasonEvents} orders soonest-to-end
 * first, which is right for the storefront band it was written for, but a live
 * season that names no kind of day must not *shadow* one that does. The demo
 * shop's own calendar is exactly that shape — a lensless "Coral spawning"
 * ending in two days beside "Turtle nesting" carrying "After dark" for another
 * ten weeks — so `[0]` would answer null on the very data the feature ships
 * with. Among the seasons that actually answer the question, the soonest to end
 * still wins.
 *
 * It reads the **joined** `lens`, never a raw `lens_id`. Deleting a kind of day
 * is soft and leaves a live id in `season_events.lens_id`, so defaulting to the
 * column would write a word the public rail no longer renders — a departure
 * labelled with something a diver can never tap.
 */
export function seasonLensForDay<T extends SeasonEventWindow & { lens: { id: string } | null }>(
  events: readonly T[],
  day: CalendarDate,
): string | null {
  return liveSeasonEvents(events, day).find((event) => event.lens)?.lens?.id ?? null;
}

/** Why a season could not be saved. Codes, never sentences — the UI picks the words. */
export type SeasonEventIssue =
  | "name_required"
  | "name_too_long"
  | "note_too_long"
  | "starts_on_invalid"
  | "ends_on_invalid"
  | "ends_before_starts";

/**
 * What is wrong with what the shop typed, as codes in the order a reader meets
 * the fields.
 *
 * `ends_before_starts` is checked here as well as by the table's own CHECK
 * constraint, because a constraint violation reaches a staffer as a 500 rather
 * than as the field turning red — the constraint is the floor under the data,
 * this is the answer to the person.
 */
export function seasonEventIssues(input: {
  name: string;
  note: string | null;
  startsOn: string;
  endsOn: string;
}): SeasonEventIssue[] {
  const issues: SeasonEventIssue[] = [];
  const name = input.name.trim();
  if (name.length === 0) issues.push("name_required");
  else if (name.length > SEASON_EVENT_NAME_MAX) issues.push("name_too_long");
  if ((input.note?.trim().length ?? 0) > SEASON_EVENT_NOTE_MAX) issues.push("note_too_long");
  if (!isValidCalendarDate(input.startsOn)) issues.push("starts_on_invalid");
  if (!isValidCalendarDate(input.endsOn)) issues.push("ends_on_invalid");
  if (
    isValidCalendarDate(input.startsOn) &&
    isValidCalendarDate(input.endsOn) &&
    input.endsOn < input.startsOn
  ) {
    issues.push("ends_before_starts");
  }
  return issues;
}
