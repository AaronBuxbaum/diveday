import { type CounterSeat, isNoShowAtCounter, isSettledAtCounter } from "@/lib/check-in";

/** Readiness will not clear this seat right now — whether or not it checked in. */
export function isBlockedAtCounter(seat: CounterSeat): boolean {
  return seat.readiness.status !== "ready";
}

/**
 * **A released seat the desk saw and turned away** (H-20261015-who-may-turn-someone), rather than one
 * whose diver never came. Same release, different statement, so the counter
 * says it in its own words and its own count.
 */
export function isTurnedAwayAtCounter(seat: CounterSeat): boolean {
  return isNoShowAtCounter(seat) && Boolean(seat.turnedAwayAt);
}

/**
 * **Everyone expected is here and nobody is blocked** — the trigger for the
 * counter's one earned line (persona task 71; the coral budget's "The counter"
 * row). An empty queue is *not* a cleared queue: there is nothing to have
 * cleared, so this stays false and the page's plain empty state renders
 * instead.
 *
 * "Everybody checked in" alone is not the condition. A boat with every diver
 * through the counter and one of them blocked still has work on it, and the
 * accent is this app's signal to stop chasing.
 */
export function counterIsClear(seats: readonly CounterSeat[]): boolean {
  // **A released seat is not somebody still to chase.** Marking a no-show is a
  // staffer saying, in as many words, that this diver is not coming — so the
  // boat whose last outstanding name was that diver is clear, and holding the
  // accent back until the row ages out of the window would be the app arguing
  // with the person who just told it (issue #1209).
  const present = seats.filter((seat) => !isNoShowAtCounter(seat));
  return present.length > 0 && present.every(isSettledAtCounter);
}

/**
 * **The instrument's three counts, in one pass, guaranteed disjoint.**
 *
 * `here + cantBoard + toCome === expected`, always — which is the property the
 * counter's whole composition rests on: the figure, the two remainder phrases
 * and the meter's bands are one statement about one boat, and a staffer reading
 * "3 to come · 2 can't board yet" must never have to work out whether the two
 * overlap. They did: `toCome` was `expected - here` and counted the blocked
 * divers a second time, over a meter drawing them as their own band.
 */
export function counterTally(seats: readonly CounterSeat[]): {
  /** Everyone the boat is still expecting — the three bands below sum to this. */
  expected: number;
  /** Through the counter: checked in and still cleared. */
  here: number;
  /** Readiness refuses them, checked in or not. */
  cantBoard: number;
  /** Cleared, and not here yet. */
  toCome: number;
  /** Seats a staffer released because the diver never came (issue #1209). */
  notHere: number;
  /** Seats a staffer released after turning the diver away at the desk (H-20261015-who-may-turn-someone). */
  turnedAway: number;
} {
  // **A released seat leaves `expected` rather than joining a fourth band of
  // it.** "4 of 7 here" is a claim about who the boat is carrying, and a
  // staffer who has just said one diver is not coming should read "4 of 6" —
  // otherwise the figure can never complete and the cleared line never lands.
  // Reported separately so the number is still said out loud: a count that
  // silently drops a person is the other way to lie about a boat.
  const released = seats.filter(isNoShowAtCounter);
  const turnedAway = released.filter(isTurnedAwayAtCounter).length;
  const notHere = released.length - turnedAway;
  const present = seats.filter((seat) => !isNoShowAtCounter(seat));
  const here = present.filter(isSettledAtCounter).length;
  const cantBoard = present.filter(isBlockedAtCounter).length;
  return {
    expected: present.length,
    here,
    cantBoard,
    toCome: present.length - here - cantBoard,
    notHere,
    turnedAway,
  };
}
