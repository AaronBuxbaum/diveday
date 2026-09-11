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
export type CounterSeat = {
  bookingStatus: string;
  readiness: { status: string };
  /**
   * The arrival was typed at the lobby tablet rather than seen by a staffer
   * (N-24). Optional so every caller that predates the kiosk keeps its
   * meaning: absent is "a person tapped this", which is what it always was.
   */
  selfReported?: boolean;
};

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
 * **A seat a staffer released**: the diver never turned up, somebody said so
 * at the counter, and the seat went back to the shop (issue #1209).
 *
 * Not "settled", and the distinction is the whole reason this is its own
 * predicate rather than a widening of `isSettledAtCounter`. Settled means the
 * diver is through the door and cleared to board; this means nobody is
 * boarding on that seat at all. The counter is finished with both, which is
 * what `counterIsDone` says, but every figure on the page that means *people*
 * — here, can't board, to come, expected — has to leave this one out or it
 * counts a person the boat is not carrying.
 */
export function isNoShowAtCounter(seat: CounterSeat): boolean {
  return seat.bookingStatus === "no_show";
}

/**
 * **The counter has nothing left to do with this seat** — it settled, or it
 * was released.
 *
 * The split `CounterQueue` draws its two groups on. The working list is the
 * people a staffer can still act on, and a released seat is not one of them:
 * leaving it up there is a name in a queue of names that needs no tap, which
 * is exactly the noise the settled group exists to take away.
 */
export function counterIsDone(seat: CounterSeat): boolean {
  return isSettledAtCounter(seat) || isNoShowAtCounter(seat);
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
 *
 * **Nor is "everybody typed their name into the tablet".** Since N-24 a seat
 * can settle without any staffer having laid eyes on the diver, and proxy
 * check-in is the ordinary use of a self-serve kiosk rather than an abuse of
 * one — one half of a couple parks the car while the other types both
 * surnames. "Everybody is here" is a claim only a human can make, so a single
 * self-reported arrival holds the accent back and the queue stays a list of
 * work. The seat still counts as `here`; what it does not do is end the
 * chasing (`dive-domain-expert` review, 2026-09-09).
 */
export function counterIsClear(seats: readonly CounterSeat[]): boolean {
  // **A released seat is not somebody still to chase.** Marking a no-show is a
  // staffer saying, in as many words, that this diver is not coming — so the
  // boat whose last outstanding name was that diver is clear, and holding the
  // accent back until the row ages out of the window would be the app arguing
  // with the person who just told it (issue #1209).
  const present = seats.filter((seat) => !isNoShowAtCounter(seat));
  return present.length > 0 && present.every(isSettledAtCounter) && !present.some(isSelfReported);
}

/** This seat's arrival is hearsay: typed at the tablet, unseen by a staffer. */
export function isSelfReported(seat: CounterSeat): boolean {
  return seat.selfReported === true && seat.bookingStatus === "checked_in";
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
  /** Everyone the boat is still expecting — the three bands below sum to this. */
  expected: number;
  /** Through the counter: checked in and still cleared. */
  here: number;
  /** Readiness refuses them, checked in or not. */
  cantBoard: number;
  /** Cleared, and not here yet. */
  toCome: number;
  /** Seats a staffer released: the diver is not coming (issue #1209). */
  notHere: number;
} {
  // **A released seat leaves `expected` rather than joining a fourth band of
  // it.** "4 of 7 here" is a claim about who the boat is carrying, and a
  // staffer who has just said one diver is not coming should read "4 of 6" —
  // otherwise the figure can never complete and the cleared line never lands.
  // Reported separately so the number is still said out loud: a count that
  // silently drops a person is the other way to lie about a boat.
  const notHere = seats.filter(isNoShowAtCounter).length;
  const present = seats.filter((seat) => !isNoShowAtCounter(seat));
  const here = present.filter(isSettledAtCounter).length;
  const cantBoard = present.filter(isBlockedAtCounter).length;
  return {
    expected: present.length,
    here,
    cantBoard,
    toCome: present.length - here - cantBoard,
    notHere,
  };
}
