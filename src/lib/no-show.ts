import { HOUR_MS, MINUTE_MS } from "./clock";
import { ARRIVALS_LOOKBACK_HOURS } from "./operational-window";
import type { SimilarDeparture } from "./similar-departures";

/**
 * **Whether a staffer may record that this diver never turned up, and what the
 * shop can do with the seat afterwards** (issue #1209).
 *
 * Nothing in the product wrote `bookings.status = "no_show"` before this: the
 * enum value existed and a dozen readers branched on it, all dead. So this
 * module is the gate in front of the first writer, and the first place the
 * product states what a no-show *is*.
 *
 * **The staffer's confirm tap is the seat release.** `docs/product/features/
 * roadmap.md` specifies exactly that — the mark is a human act, the seat
 * becoming sellable is its consequence, and nothing releases on a timer. That
 * is why there is no `seat_released_at` column and no second tap: a release
 * that needed one would make the wait-list invite beside it a promise the
 * product could not keep, dead-ending at `trip_full` the moment somebody
 * accepted it.
 *
 * Codes and numbers only — the words live in the staff bundle (ADR
 * 20260731-domain-layer-copy-leaks).
 */

/**
 * The booking statuses that hold a seat on a departure.
 *
 * This is the ticket's boundary written as data. `cancelled` never held one,
 * and from this slice on `no_show` no longer does either: a staffer has said
 * the diver is not coming, so the seat is the shop's to sell. Every capacity
 * count reads this rather than spelling `ne(status, "cancelled")` again,
 * because a missed call site reads on a shop's screen as a boat saying
 * "Full" over a seat that is actually free — or, the other way round, as an
 * oversell.
 */
export const SEAT_HELD_STATUSES = ["booked", "checked_in"] as const;

export type SeatHeldStatus = (typeof SEAT_HELD_STATUSES)[number];

/** Whether this booking status still holds a seat against capacity. */
export function seatIsHeld(status: string): status is SeatHeldStatus {
  return (SEAT_HELD_STATUSES as readonly string[]).includes(status);
}

/**
 * What the counter is allowed to do with a seat, or why not.
 *
 * - `eligible` — the door renders.
 * - `already_boarded` — **the refusal that matters.** The crew recorded this
 *   diver onto the boat at roll call, so they are on the water. Marking them
 *   absent takes a person the manifest is holding off the expected list while
 *   somebody may already be counting heads at the rail. A statement the crew
 *   made at the boat outranks one made at a desk, the same way
 *   `undoCheckInBooking` already lets an aboard record outrank a queued
 *   offline retraction.
 * - `already_marked` — a second device, or a second tap, arriving after the
 *   work is done.
 * - `not_booked` — the seat was given up (cancelled). Somebody who told the
 *   shop they were not coming is not a no-show, and the distinction is the
 *   whole difference between a courtesy and an accusation.
 * - `trip_cancelled` — nobody fails to show for a boat that never left.
 * - `before_dock_call` — the diver is not late yet.
 * - `window_closed` — the counter's own backward reach has passed and this is
 *   history rather than work; a correction there belongs on the booking, not
 *   on a queue row.
 */
export type NoShowGate =
  | "eligible"
  | "already_boarded"
  | "already_marked"
  | "not_booked"
  | "trip_cancelled"
  | "before_dock_call"
  | "window_closed";

export type NoShowGateInput = {
  bookingStatus: string;
  /** The crew recorded this diver aboard at roll call. */
  boarded: boolean;
  tripStatus: "scheduled" | "cancelled";
  startsAt: Date;
  /** The shop's own arrival call, in minutes before departure. */
  dockCallMinutes: number;
  now: Date;
};

/**
 * The window a no-show can be recorded in: from the shop's own dock call until
 * the counter stops looking backwards.
 *
 * Both ends are the counter's, deliberately. The opening is `dockCallMinutes`
 * because that is the moment the shop itself asked the diver to be standing
 * there — earlier than that nobody is late, and a door offering "Not here?"
 * over a diver who is not due for two hours is an invitation to a mistake on a
 * shared desk tablet. The closing is {@link ARRIVALS_LOOKBACK_HOURS}, the same
 * reach `arrivalsWindow` gives the queue, so the door can never outlive the row
 * it sits on.
 */
export function noShowGate(input: NoShowGateInput): NoShowGate {
  // Safety first, and ahead of every other condition so none of them can mask
  // it: a diver on the water is never a no-show, whatever the clock says and
  // whatever the row says.
  if (input.boarded) return "already_boarded";
  if (input.bookingStatus === "no_show") return "already_marked";
  if (!seatIsHeld(input.bookingStatus)) return "not_booked";
  if (input.tripStatus === "cancelled") return "trip_cancelled";
  const startsAt = input.startsAt.getTime();
  const now = input.now.getTime();
  if (now < startsAt - input.dockCallMinutes * MINUTE_MS) return "before_dock_call";
  if (now > startsAt + ARRIVALS_LOOKBACK_HOURS * HOUR_MS) return "window_closed";
  return "eligible";
}

/**
 * **What the shop can offer the seat to**, once a staffer has released it.
 *
 * The salvage is the half of this ticket that makes the mark worth making: a
 * released seat with nothing offered against it is an empty space on a boat
 * that has already sailed past the dock call. Precedence is wait list, then a
 * similar departure, then nothing — and it is precedence rather than a list
 * because the counter has seconds, not a page:
 *
 * - **the wait list first**, because those divers asked for this exact boat and
 *   the shop already has their answer. Nothing beats a diver who is waiting.
 * - **a similar departure second**, through `similarDepartures`' same-course /
 *   same-site rule, so the offer is a real alternative rather than the schedule
 *   with extra steps.
 * - **nothing third**, said plainly. A surface that invents an offer here is
 *   worse than one that says there is nobody waiting.
 */
export type SalvageOffer =
  | { kind: "waitlist"; count: number }
  | { kind: "alternative"; departures: readonly SimilarDeparture[] }
  | { kind: "none" };

export function salvageOffer(input: {
  /** Wait-list entries on this departure nobody has invited yet. */
  waitlistCount: number;
  alternatives: readonly SimilarDeparture[];
}): SalvageOffer {
  if (input.waitlistCount > 0) return { kind: "waitlist", count: input.waitlistCount };
  if (input.alternatives.length > 0) return { kind: "alternative", departures: input.alternatives };
  return { kind: "none" };
}
