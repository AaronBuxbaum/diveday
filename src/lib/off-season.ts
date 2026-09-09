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
 * honestly say about when it is not.** Codes, instants and calendar dates —
 * never sentences.
 *
 * **Nothing new is stored.** The two facts this needs are already written
 * down twice over: a departure the shop put on the board is the strongest
 * possible statement that it is running that day, and `season_events` is the
 * shop's own writing about the weeks its year turns on (issue #1485). A third
 * place to say "we open in March" would be the one nobody remembers to
 * update, and a storefront confidently naming a date the shop has moved on
 * from is worse than one that names none.
 */

import type { CalendarDate } from "./calendar-date";
import type { SeasonEventWindow } from "./season-events";
import { seasonEventState } from "./season-events";

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
export type OffSeason<T> = {
  /** True while nothing public is scheduled inside the quiet window. */
  quiet: boolean;
  /**
   * The first public departure back on the board, when the shop has scheduled
   * one beyond the window. Null while the board is empty outright — there is
   * then no departure to name, and inventing a date is not this module's job.
   */
  opensAt: Date | null;
  /**
   * The soonest season the shop has written that has not opened yet — the one
   * honest date a shop with an empty board still has on file.
   *
   * Only ever set when `opensAt` is null. A departure the shop actually
   * scheduled outranks a week it merely wrote about, and naming both would
   * put two answers to one question on one card.
   */
  nextSeason: T | null;
};

/**
 * Whether the board is quiet, and the soonest thing the shop can point at.
 *
 * `firstDeparture` is the earliest **public, scheduled, live** departure ahead
 * of now — `upcomingScheduleRange(db, shopId, now, { publicOnly: true }).first`
 * is exactly it, and the storefront already reads it. A private charter and a
 * departure the shop deleted are both absent from it by construction, which is
 * what keeps this from telling a stranger about a day they cannot book.
 *
 * `today` is the shop's **own** calendar day (`calendarDateInTimezone(now,
 * shop.timezone)`), because a season is two calendar dates with no instant in
 * them: a window that opens on 29 July opens when it is 29 July at the shop,
 * not in UTC. The departure comparison is a real instant difference, since a
 * departure *is* a moment on a clock.
 */
export function offSeason<T extends SeasonEventWindow>({
  now,
  firstDeparture,
  today,
  seasons = [],
  quietDays = OFF_SEASON_QUIET_DAYS,
}: {
  now: Date;
  firstDeparture: Date | null;
  today: CalendarDate;
  seasons?: readonly T[];
  quietDays?: number;
}): OffSeason<T> {
  const quiet =
    firstDeparture === null || firstDeparture.getTime() - now.getTime() > quietDays * DAY_MS;
  if (!quiet) return { quiet: false, opensAt: null, nextSeason: null };
  if (firstDeparture) return { quiet: true, opensAt: firstDeparture, nextSeason: null };
  const upcoming = seasons
    .filter((season) => seasonEventState(season, today) === "upcoming")
    // Calendar dates compare as plain strings — that is the whole reason they
    // are stored as `YYYY-MM-DD` (src/lib/calendar-date.ts).
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0));
  return { quiet: true, opensAt: null, nextSeason: upcoming[0] ?? null };
}
