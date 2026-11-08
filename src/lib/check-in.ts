/** Shared counter seat predicates used by the live desk and offline dock copy. */

/**
 * Framework-free helpers for the counter check-in queue
 * (`src/app/shop/[shopSlug]/trips/[id]/_arrivals/arrival-desk.tsx` + `src/features/check-in/store.ts`).
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
  /** The desk has them seen: the arrival trail's word (`seatCheckedIn`, issue #2702). */
  checkedIn: boolean;
  readiness: { status: string };
  /** Set on a released seat the desk turned away (H-20261015-who-may-turn-someone); absent or null otherwise. */
  turnedAwayReason?: string | null;
  /**
   * When the desk turned this seat away: the fact, which erasure keeps while
   * it clears the category. What makes a release "turned away".
   */
  turnedAwayAt?: Date | null;
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
  return seat.bookingStatus === "booked" && seat.checkedIn && seat.readiness.status === "ready";
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
 * The split the arrival desk's groups follow. The working list is the
 * people a staffer can still act on, and a released seat is not one of them:
 * leaving it up there is a name in a queue of names that needs no tap, which
 * is exactly the noise the settled group exists to take away.
 *
 * The dock copy's counter reads the same predicate (`OfflineManifestView`,
 * issue #1705) and goes one step further with the released half: that row gets
 * no check-in control at all, because a tap on it is one `checkInBooking`
 * refuses as `not_bookable` the moment the batch reaches signal. Boarding is
 * untouched on both surfaces — the crew can see a body, and the rail takes the
 * seat back.
 */
export function counterIsDone(seat: CounterSeat): boolean {
  return isSettledAtCounter(seat) || isNoShowAtCounter(seat);
}
