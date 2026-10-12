import { type CalendarDate, calendarDateInTimezone, isValidCalendarDate } from "./calendar-date";

/**
 * **The off-season as a designed state** (N-45).
 *
 * A shop's storefront is the first thing a stranger sees, and for a Florida
 * operation in January — or any shop between seasons — it showed an empty
 * schedule and the words "No trips on the books yet". That is the worst
 * sentence a shopfront can hand somebody who is trying to decide where to
 * dive in April: it reads as a shop that has stopped, rather than one that
 * has not started.
 *
 * The framework-free half: **is the board quiet, and what can the shop
 * honestly say about when it is not.** Codes and instants —
 * never sentences.
 *
 * **The sooner of a departure and the typed date.** A departure the shop put
 * on the board is the strongest possible statement that it is running that
 * day, so it is named unless the date the shop typed in Settings
 * (`shops.reopens_on`, 2026-10-12) comes before it: a shop back out on 1
 * February with only a May trip scheduled so far is open in between, and
 * naming May would say otherwise (review 3b). On an empty board the typed date
 * is all there is: a shop between seasons, with next year not yet scheduled,
 * could otherwise tell nobody when it reopens. That date speaks
 * only while it is still ahead, so one nobody updated goes quiet by itself the
 * day it passes rather than naming a reopening that has come and gone.
 */

/**
 * How long a board has to be empty before the storefront says so.
 *
 * Thirty days, because that is the horizon a diver plans a trip inside: a
 * shop with nothing next weekend but a full board in three weeks is having a
 * quiet fortnight, not an off-season, and telling its visitors otherwise
 * would cost it the bookings it does have.
 */
export const OFF_SEASON_QUIET_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the storefront knows about a quiet board, and nothing it does not. */
export type OffSeason = {
  /** True while nothing public is scheduled inside the quiet window. */
  quiet: boolean;
  /**
   * The first public departure back on the board, when the shop has scheduled
   * one beyond the window and has typed no sooner date. Null while the board
   * is empty outright — inventing a date is not this module's job.
   */
  opensAt: Date | null;
  /**
   * The shop's own "back out on" date, only while it is still ahead of the
   * shop's today and before the first departure scheduled, if any. Null
   * whenever `opensAt` is set: at most one date is named.
   */
  reopensOn: CalendarDate | null;
};

/**
 * Whether the board is quiet, and the soonest thing the shop can point at.
 *
 * `firstDeparture` is the earliest **public, scheduled, live** departure ahead
 * of now — `upcomingScheduleRange(db, shopId, now, { publicOnly: true }).first`
 * is exactly it, and the storefront already reads it. A private charter and a
 * departure the shop deleted are both absent from it by construction, which is
 * what keeps this from telling a stranger about a day they cannot book.
 */
export function offSeason({
  now,
  firstDeparture,
  reopensOn = null,
  timeZone,
  quietDays = OFF_SEASON_QUIET_DAYS,
}: {
  now: Date;
  firstDeparture: Date | null;
  /** `shops.reopens_on`: the shop's typed date, a shop-local calendar date. */
  reopensOn?: CalendarDate | null;
  /** The shop's zone, which decides whether `reopensOn` is still ahead. */
  timeZone: string;
  quietDays?: number;
}): OffSeason {
  const quiet =
    firstDeparture === null || firstDeparture.getTime() - now.getTime() > quietDays * DAY_MS;
  const typed =
    quiet &&
    reopensOn !== null &&
    isValidCalendarDate(reopensOn) &&
    reopensOn > calendarDateInTimezone(now, timeZone) &&
    (firstDeparture === null || reopensOn < calendarDateInTimezone(firstDeparture, timeZone))
      ? reopensOn
      : null;
  return { quiet, opensAt: quiet && typed === null ? firstDeparture : null, reopensOn: typed };
}
