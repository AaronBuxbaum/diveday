/**
 * **Presence: what the trails say about one person on one departure**, read
 * and never written (issues #2702, #2704).
 *
 * Dependency-free like `roll-call.ts`, so the offline service worker can share
 * it. A seat has two lifecycles, and since issue #2702 they are two records
 * rather than one column: `bookings.status` says what the shop decided about
 * the seat (held, released, cancelled), and where the person has got to is a
 * trail, `booking_arrival_events` for the desk and `roll_call_events` for the
 * rail. Nothing mirrors the trail onto the seat, so a no-show, a cancel, a
 * reclaim or a restore touches the seat word and leaves the sighting standing
 * (ADR 20261104-arrival-is-a-trail).
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
 * **Checked in**: the seat is still held and the desk's trail has the person
 * seen. Both halves, always — a released (`no_show`) or cancelled seat keeps
 * its `arrived` row standing, and reading the trail alone would put the diver
 * the desk wrote off back on the counter as through it. The SQL spelling of
 * the same rule is `seatCheckedIn` (src/db/arrival-provenance.ts); the two
 * must agree.
 *
 * Never "aboard": a diver checked in at 06:40 can be seasick on the ramp at
 * 06:50 (ADR 20260907-the-counter-survives-offline, decision 4).
 */
export function isCheckedIn(seatStatus: string, standing: StandingArrival | undefined): boolean {
  return seatStatus === "booked" && hasArrived(standing);
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
