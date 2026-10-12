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
 * **A departure outranks anything typed.** A departure the shop put on the
 * board is the strongest possible statement that it is running that day, so it
 * is always the date named when there is one. Only a board with nothing on it
 * at all falls back to the date the shop typed in Settings
 * (`shops.reopens_on`, 2026-10-12): a shop between seasons, with next year not
 * yet scheduled, could otherwise tell nobody when it reopens. That date speaks
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
   * one beyond the window. Null while the board is empty outright — there is
   * then no departure to name, and inventing a date is not this module's job.
   */
  opensAt: Date | null;
  /**
   * The shop's own "back out on" date, only while the board is empty outright
   * and the date is still ahead of the shop's today. Null whenever `opensAt` is
   * set: a scheduled departure is the fact, and the typed date only a plan.
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
    firstDeparture === null &&
    reopensOn !== null &&
    isValidCalendarDate(reopensOn) &&
    reopensOn > calendarDateInTimezone(now, timeZone)
      ? reopensOn
      : null;
  return { quiet, opensAt: quiet ? firstDeparture : null, reopensOn: typed };
}
