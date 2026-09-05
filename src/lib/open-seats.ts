import { nowDate } from "./clock";
import { hasSailed } from "./trips";
import { utcToWallTime } from "./zoned";

/**
 * **What the shop already knows about the seats that stayed open** (issue
 * #1207, delight report D47; ADR 20260904-reef-all-the-way-down, slice 16h).
 *
 * A departure that sailed short is the one commercial question a dive shop
 * asks itself in the evening, and the app is holding every fact needed to
 * answer it: when the last booking came in, whether the last-minute deal ever
 * went out, and whether the same trip filled the last time it ran. Nobody was
 * reading them together, so the answer lived in somebody's memory of the week.
 *
 * **Three boundaries, and they are the shape of this type.** It carries no
 * crew field, no rank and no rate: #1207's own boundary is that this is never
 * a performance leaderboard, and the surest way to keep it one is to have
 * nothing here that could become one. And it states facts rather than advice —
 * there is no "try posting the deal earlier" clause, because a shop knows its
 * own market and DiveDay does not.
 *
 * Codes and numbers only. `src/i18n/closeout-labels.ts` composes the sentence.
 */
export type OpenSeatsDebrief = {
  /** Seats the departure sailed without. Always positive — a full boat is null. */
  openSeats: number;
  /**
   * Whole shop-local calendar days between the last booking and the departure.
   * `0` is "the last one came in on the day"; null when nothing was ever booked.
   */
  lastBookingDaysOut: number | null;
  /** Whether a last-minute deal went out on this departure at all. */
  dealSent: boolean;
  /**
   * The most recent comparable departure that filled — same title, same shop,
   * already behind this one. `samePrice` is a fact, never a recommendation.
   */
  comparable: { title: string; startsAt: Date; samePrice: boolean } | null;
};

export type OpenSeatsInput = {
  capacity: number;
  /** Non-cancelled bookings, the same roster the station counts. */
  booked: number;
  startsAt: Date;
  timeZone: string;
  /** The newest non-cancelled booking on this departure, or null if none. */
  lastBookingAt: Date | null;
  dealSent: boolean;
  comparable: { title: string; startsAt: Date; samePrice: boolean } | null;
};

/**
 * The debrief for one departure, or null when there is nothing true to say.
 *
 * Null in three situations, and the first is the common one: **the departure
 * filled**. A boat that sailed full has no open seats to explain, and a row
 * saying so would be the surface congratulating itself once per station. Null
 * again for a departure that never sailed — a trip still ahead of the clock
 * has seats, not a shortfall — and null when every clause is absent, which is
 * the ADR's standing rule that a widening renders nothing when it is not true.
 */
export function openSeatsDebrief(
  input: OpenSeatsInput,
  now: Date = nowDate(),
): OpenSeatsDebrief | null {
  const openSeats = input.capacity - input.booked;
  if (openSeats <= 0) return null;
  if (!hasSailed(input.startsAt, now)) return null;

  const lastBookingDaysOut = input.lastBookingAt
    ? Math.max(0, calendarDaysBetween(input.lastBookingAt, input.startsAt, input.timeZone))
    : null;
  const debrief: OpenSeatsDebrief = {
    openSeats,
    lastBookingDaysOut,
    dealSent: input.dealSent,
    comparable: input.comparable,
  };
  // A deal that *did* go out is not a clause: it is the shop having already
  // done the thing, which needs no sentence. The absent one is what the
  // evening can still act on tomorrow.
  const hasClause = lastBookingDaysOut !== null || !input.dealSent || input.comparable !== null;
  return hasClause ? debrief : null;
}

/**
 * Whole calendar days from `from` to `to`, both read on the shop's own clock.
 *
 * Calendar days rather than elapsed hours, because "the last booking came in
 * one day out" is a thing a person says about dates, not about a 24-hour
 * window: a booking taken at 11 p.m. the night before a dawn departure is one
 * day out, and eight hours of elapsed time would call it zero. Each wall time
 * is projected onto a UTC midnight before subtracting, which is what makes the
 * arithmetic immune to the DST hour between the two dates.
 */
function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const start = utcToWallTime(from, timeZone);
  const end = utcToWallTime(to, timeZone);
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  const endDay = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endDay - startDay) / (24 * 60 * 60 * 1000));
}
