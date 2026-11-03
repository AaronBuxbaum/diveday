/**
 * **Presence: what the trails say about one person on one departure**, read
 * and never written (issues #2702, #2704).
 *
 * Dependency-free like `roll-call.ts`, so the offline service worker can share
 * it. A seat has two lifecycles that `bookings.status` still folds into one
 * column: what the shop decided about the seat (held, released, cancelled) and
 * where the person has got to (seen at the desk, aboard). The second is a
 * trail, `booking_arrival_events` for the desk and `roll_call_events` for the
 * rail, and the column only mirrors it. This module is where the mirror is
 * read from, so a writer that puts a released seat back asks one question in
 * one place instead of spelling the answer itself.
 *
 * **The trail is a record of who was seen, never of who dived.** A standing
 * `arrived` row says the desk saw the person; the boat carrying them is the
 * roll call's word, and `seatSailed` (src/features/today/closeout.ts) is the rule that
 * reads it. Nothing here may be spent as evidence about the water.
 */

/** What a standing arrival row says, as `booking_arrival_events.status` stores it. */
export type StandingArrival = "arrived" | "cleared";

/** Whether the desk's trail, newest row first, still has this person seen. */
export function hasArrived(standing: StandingArrival | undefined): boolean {
  return standing === "arrived";
}

/**
 * The slot a released (`no_show`) seat goes back to: `checked_in` while the
 * trail still says the desk saw the person, `booked` otherwise. A restore that
 * always wrote `booked` put a diver the counter had checked in back on the
 * "still to come" list (issue #1838). Both slots hold the seat.
 *
 * The one function behind `undoBookingNoShow` and `reclaimReleasedSeat`; they
 * must agree or the slot and the trail drift apart.
 */
export function seatStatusAfterRelease(
  standing: StandingArrival | undefined,
): "checked_in" | "booked" {
  return hasArrived(standing) ? "checked_in" : "booked";
}

/**
 * The words a person on a departure can be in, as one derived state. Each has
 * exactly one label per locale (`src/i18n/presence-labels.ts`), so a surface
 * that draws the boat picks a state instead of spelling a word.
 *
 * - `arrived`: the desk's trail has them seen.
 * - `boarded` / `not_boarded`: the rail's standing departure result.
 * - `missing_after_dive`: said not back aboard at an after-dive checkpoint.
 * - `released`: the desk said they are not here and freed the seat.
 *
 * A state is added with its first surface, never ahead of it: an unused word
 * is copy nobody reviewed.
 */
export const PRESENCE_STATES = [
  "arrived",
  "boarded",
  "not_boarded",
  "missing_after_dive",
  "released",
] as const;

export type PresenceState = (typeof PRESENCE_STATES)[number];
