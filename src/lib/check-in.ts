/**
 * Framework-free helpers for the counter check-in queue
 * (`src/app/shop/[shopSlug]/check-in/page.tsx` + `src/db/check-in.ts`).
 *
 * The predicates below cut a departure's seats into the counter's three
 * disjoint groups — settled, blocked, still to come — and every figure, meter
 * band and queue group on that surface derives from them. One module, because
 * they have to agree: an instrument painting a band the queue does not list is
 * how a boat reads all-clear over somebody who cannot board (ADR
 * 20260827-clearwater-surface-language, decision 9).
 */

/**
 * The two facts the counter judges a seat on: whether the diver is through the
 * counter, and whether readiness still clears them. Structural rather than
 * `CheckInQueueRow`, so this module stays free of `src/db`.
 */
export type CounterSeat = { bookingStatus: string; readiness: { status: string } };

/**
 * **A seat the counter is finished with**: checked in *and* still cleared to
 * board.
 *
 * Readiness is re-read on every render and a check-in does not freeze it — a
 * refund landing, a card corrected, a captain moving the second tank to a
 * deeper site all raise a blocker on a diver who came through the door an hour
 * ago (`listTripsReadiness` excludes cancelled bookings and nothing else). Such
 * a seat is emphatically not settled: it is the one the counter exists to catch
 * **ashore**, while the diver is still standing in front of somebody, rather
 * than at the rail where the manifest's gate is the only thing left.
 */
export function isSettledAtCounter(seat: CounterSeat): boolean {
  return seat.bookingStatus === "checked_in" && seat.readiness.status === "ready";
}

/** Readiness will not clear this seat right now — whether or not it checked in. */
export function isBlockedAtCounter(seat: CounterSeat): boolean {
  return seat.readiness.status !== "ready";
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
  return seats.length > 0 && seats.every(isSettledAtCounter);
}

/**
 * **Is "First visit" worth a row's height on this screen?**
 *
 * The marker is a fact a staffer can be warmer for, not a state anybody has to
 * act on, and its whole value is that it singles somebody out. On a shop's
 * first season every diver in the queue is a first visit — so it rendered on
 * every row, at exactly the length of queue where the counter's promise is a
 * name and one tap, and marked nobody. A line that would apply to everyone
 * present distinguishes nothing, and AGENTS.md deletes a sentence that does not
 * change what the reader would do.
 *
 * Judged across the **whole visible queue**, the same scope as the ambiguous-name
 * rule the counter already applies to emails: a staffer reads down the page, and
 * "everyone on this screen" is the set the word is being weighed against.
 */
export function firstVisitMarksAnException(seats: readonly { firstVisit: boolean }[]): boolean {
  return seats.some((seat) => !seat.firstVisit) && seats.some((seat) => seat.firstVisit);
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
  /** Everyone booked on the departure. */
  expected: number;
  /** Through the counter: checked in and still cleared. */
  here: number;
  /** Readiness refuses them, checked in or not. */
  cantBoard: number;
  /** Cleared, and not here yet. */
  toCome: number;
} {
  const here = seats.filter(isSettledAtCounter).length;
  const cantBoard = seats.filter(isBlockedAtCounter).length;
  return { expected: seats.length, here, cantBoard, toCome: seats.length - here - cantBoard };
}
