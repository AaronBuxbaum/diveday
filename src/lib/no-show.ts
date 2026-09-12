import { HOUR_MS } from "./clock";
import { ARRIVALS_LOOKBACK_HOURS } from "./operational-window";
import type { SimilarDeparture } from "./similar-departures";
import { hasSailed } from "./trips";

/**
 * **Whether a staffer may record that this diver never turned up, and what the
 * shop can do with the seat afterwards** (issue #1209).
 *
 * Nothing in the product wrote `bookings.status = "no_show"` before this: the
 * enum value existed and a dozen readers branched on it, all dead. So this
 * module is the gate in front of the first writer, and the first place the
 * product states what a no-show *is*.
 *
 * **The staffer's confirm tap is the seat release.** The mark is a human act,
 * the seat becoming sellable is its consequence, and nothing releases on a
 * timer. That is why there is no `seat_released_at` column and no second tap:
 * a release that needed one would make the wait-list invite beside it a
 * promise the product could not keep, dead-ending at `trip_full` the moment
 * somebody accepted it. The boundary and the three shapes it beat are recorded in ADR
 * 20260911-the-confirm-tap-is-the-release; the glossary's **seat release**,
 * **seat held** and **salvage offer** entries are the short forms.
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
 *   diver onto the boat at roll call — at the dock, or at any later head
 *   count — so they are on the water. Marking them absent takes a person the
 *   manifest is holding off the expected list while somebody may already be
 *   counting heads at the rail. A statement the crew made at the boat outranks
 *   one made at a desk, the same way `undoCheckInBooking` already lets an
 *   aboard record outrank a queued offline retraction. When the crew get there
 *   *second* the same ordering holds without a refusal: boarding a diver
 *   already marked absent takes the released seat back rather than being
 *   turned away, because nothing at the rail may refuse a body somebody is
 *   looking at (`reclaimReleasedSeat`, src/db/manifests.ts).
 * - `already_marked` — a second device, or a second tap, arriving after the
 *   work is done.
 * - `not_booked` — the seat was given up (cancelled). Somebody who told the
 *   shop they were not coming is not a no-show, and the distinction is the
 *   whole difference between a courtesy and an accusation.
 * - `trip_cancelled` — nobody fails to show for a boat that never left.
 * - `before_departure` — the boat has not left without them yet.
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
  | "before_departure"
  | "window_closed";

export type NoShowGateInput = {
  bookingStatus: string;
  /**
   * The crew recorded this diver aboard at roll call, at **any** checkpoint:
   * a diver counted at the second site was never at the dock at all
   * (`boardedAtAnyCheckpoint`, src/db/manifests.ts).
   */
  boarded: boolean;
  tripStatus: "scheduled" | "cancelled";
  startsAt: Date;
  now: Date;
};

/**
 * The window a no-show can be recorded in: from the moment the boat leaves
 * without them until the counter stops looking backwards.
 *
 * **The opening is the departure, not the shop's dock call** (dive-domain-expert
 * review, 2026-09-11). It was the dock call for one slice, argued as the moment
 * the shop itself asked the diver to be standing there. That is true and it is
 * the wrong fact: late for the dock call and not coming are two different
 * statements, and the only one this tap writes is the second. At the dock call
 * the gear is not on the boat, half the manifest is in the car park, and the
 * diver stuck behind a drawbridge is an ordinary Tuesday; a door offering
 * "Not here?" over all of them on a shared desk tablet is an invitation to the
 * one mis-tap nobody ever learns to undo. The boat leaving is the first moment
 * "they did not come" is a statement rather than a guess.
 *
 * The closing stays {@link ARRIVALS_LOOKBACK_HOURS}, the same reach
 * `arrivalsWindow` gives the queue, so the door can never outlive the row it
 * sits on. What the tap *claims* inside that window is not constant, though —
 * see {@link noShowClaim}.
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
  if (now < startsAt) return "before_departure";
  if (now > startsAt + ARRIVALS_LOOKBACK_HOURS * HOUR_MS) return "window_closed";
  return "eligible";
}

/**
 * **What the staffer is claiming**, which changes the moment the boat is gone.
 *
 * The same tap is two different sentences either side of {@link hasSailed}, and
 * the surface has to say which one it is (dive-domain-expert review,
 * 2026-09-11):
 *
 * - `frees_seat` — the boat is still loading, or running late in the way boats
 *   do. The diver is not aboard, the seat is the shop's to sell, and if they
 *   come running down the dock the Undo puts them back in front of a staffer
 *   who is still standing there.
 * - `did_not_dive` — the boat has gone. The seat is worth nothing now, so the
 *   tap is no longer about a seat at all: it is a statement about a person,
 *   and `bookings.status = "no_show"` is spent as one. No recap, no tip, no
 *   review invitation, a recap pulse refused as `did_not_dive`, the day struck
 *   from their dive-day count, and their own ready link telling them they were
 *   recorded absent. The Undo still exists and nobody learns they need it: the
 *   diver is at sea or gone home, and the row has left the counter's working
 *   list. On a shop that runs no roll call `already_boarded` never fires
 *   either, so the words on the door are the only thing standing between a
 *   mis-tap and writing off a diver who dived.
 *
 * Codes only. The counter picks the two sets of sentences
 * (`checkIn.noShow.*` / `checkIn.noShow.sailed*`).
 */
export type NoShowClaim = "frees_seat" | "did_not_dive";

export function noShowClaim(input: { startsAt: Date; now: Date }): NoShowClaim {
  // `hasSailed`, never a second departure buffer: a boat an hour past its
  // scheduled time is the one the whole codebase already calls gone.
  return hasSailed(input.startsAt, input.now) ? "did_not_dive" : "frees_seat";
}

/**
 * **What the shop can still do once a staffer has released the seat.**
 *
 * The salvage is the half of this ticket that makes the mark worth making: a
 * released seat with nothing offered against it is an empty space on a boat
 * that has already sailed past the dock call. Precedence is wait list, then a
 * rebooking, then nothing — and it is precedence rather than a list because
 * the counter has seconds, not a page:
 *
 * - **the wait list first**, because those divers asked for this exact boat and
 *   the shop already has their answer. Nothing beats a diver who is waiting.
 *   This one is a buyer for the seat: the offer and the empty space are the
 *   same object.
 * - **a rebooking second, and it is about the diver, not the seat**
 *   (dive-domain-expert review, 2026-09-11). The second answer used to be the
 *   bare `similarDepartures` list the storefront shows a diver staring at a
 *   full boat, worded as departures that still have room — and a departure
 *   cannot take a seat on another departure. In the storefront there is a
 *   person in front of that list; here there was not, so on a shared desk
 *   tablet it read as two links into two other trips over a sentence saying
 *   the mark charges and refunds nothing, and a staffer could not tell whether
 *   it meant rebook the diver who just missed or go and find a stranger.
 *   `similarDepartures` is still the right rule — same course, or same site —
 *   once the offer names its subject: these are the days the shop can put
 *   **this** diver on, and the surface links to seating them.
 * - **nothing third**, said plainly. A surface that invents an offer here is
 *   worse than one that says there is nobody waiting.
 */
export type SalvageOffer =
  | { kind: "waitlist"; count: number }
  | { kind: "rebook"; departures: readonly SimilarDeparture[] }
  | { kind: "none" };

export function salvageOffer(input: {
  /** Wait-list entries on this departure nobody has invited yet. */
  waitlistCount: number;
  /** Days the diver who missed could be put on instead — `similarDepartures`. */
  alternatives: readonly SimilarDeparture[];
}): SalvageOffer {
  if (input.waitlistCount > 0) return { kind: "waitlist", count: input.waitlistCount };
  if (input.alternatives.length > 0) return { kind: "rebook", departures: input.alternatives };
  return { kind: "none" };
}
