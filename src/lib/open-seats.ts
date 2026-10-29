import { calendarDateInTimezone, calendarDaysBetween } from "./calendar-date";
import { nowDate } from "./clock";
import { hasSailed } from "./trips";

/**
 * **What the shop already knows about the seats that never sold** (issue
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
  /**
   * **Seats that never sold** — `capacity - booked`, where `booked` is every
   * non-cancelled booking. Always positive; a departure that filled is null.
   *
   * Not "seats the boat sailed without", which this said until issue #1760.
   * The two stopped agreeing when #1209 shipped the no-show counter: a
   * staffer's confirm tap *is* the seat release (ADR
   * 20260911-the-confirm-tap-is-the-release), so on a twelve-seat boat with
   * ten sold and one no-show the boat sails with three empty seats while this
   * number is two.
   *
   * **Two is the right answer here, and the reason is the company this number
   * keeps.** Every other clause on the debrief asks about selling — when the
   * last booking came in, whether the last-minute deal went out, whether the
   * same trip filled before. A seat sold and then not turned up for is a
   * different failure with a different remedy, and #1209's no-show release is
   * where that one is already answered. `sailed` is on the row beside this
   * one (`src/lib/closeout.ts`) for anything that does want the rail count.
   */
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
 * **Seats that never sold on a departure that has sailed** — `capacity -
 * booked`, 0 for a boat that filled or has not gone yet. The one definition
 * of "left with empty seats": the debrief on a departure's Details tab and
 * Reports' monthly count both read it, so the two can never disagree about
 * which departures qualify.
 */
export function unsoldSeats(
  input: Pick<OpenSeatsInput, "capacity" | "booked" | "startsAt">,
  now: Date = nowDate(),
): number {
  const open = input.capacity - input.booked;
  if (open <= 0) return 0;
  return hasSailed(input.startsAt, now) ? open : 0;
}

export type DepartureWithEmptySeats = {
  tripId: string;
  title: string;
  startsAt: Date;
  openSeats: number;
};

/**
 * **A month's departures that left with empty seats** (issue #2424): how many
 * departures and how many seats in all, and the departures themselves, the
 * emptiest first and then the earliest, so a shop sees where the money went.
 * Counts only; no crew, no rank and no rate, on the debrief's own boundary.
 */
export function departuresWithEmptySeats(
  departures: readonly (Pick<OpenSeatsInput, "capacity" | "booked" | "startsAt"> & {
    tripId: string;
    title: string;
  })[],
  now: Date = nowDate(),
): { departures: number; seats: number; list: DepartureWithEmptySeats[] } {
  const list = departures
    .map((departure) => ({
      tripId: departure.tripId,
      title: departure.title,
      startsAt: departure.startsAt,
      openSeats: unsoldSeats(departure, now),
    }))
    .filter((departure) => departure.openSeats > 0)
    .sort((a, b) => b.openSeats - a.openSeats || a.startsAt.getTime() - b.startsAt.getTime());
  return {
    departures: list.length,
    seats: list.reduce((sum, departure) => sum + departure.openSeats, 0),
    list,
  };
}

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
  const openSeats = unsoldSeats(input, now);
  if (openSeats === 0) return null;

  const lastBookingDaysOut = input.lastBookingAt
    ? Math.max(
        0,
        calendarDaysBetween(
          calendarDateInTimezone(input.lastBookingAt, input.timeZone),
          calendarDateInTimezone(input.startsAt, input.timeZone),
        ),
      )
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
