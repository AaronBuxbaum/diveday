import type { SeatDiverEntry, SeatDiverRefusal, SeatDiverRefusalDetail } from "@/db/seat-diver";
import { shopPath } from "@/lib/staff-notices";
import type { TripAdmissionGateScope } from "@/lib/trip-admission-gate";

/**
 * The per-door half of seating a diver (`src/db/seat-diver.ts` owns the other
 * half — the consequences, which are identical everywhere).
 *
 * There are two staff doors, named for where the staffer starts: **from a
 * departure** ("who is joining this boat" — the roster's Add diver, the
 * counter's walk-in, the global Add booking once it has a boat) and **from a
 * diver** ("put this person on a boat" — the diver's own record). What
 * legitimately differs between them is *presentation*: where the staffer lands
 * afterwards, which words their page already speaks, and whether a name typed at
 * the desk must come with an email. Those live here as data, one row per door,
 * so a reviewer can read the whole matrix at once instead of diffing action
 * files. Kept out of the `"use server"`
 * module beside it — such a module may only export async functions — the same
 * split as `./waiver-send-types.ts`.
 *
 * Notice codes, not sentences: each page still looks these up in its own
 * `?notice=` map against the staff bundle.
 */

/**
 * The one notice every door shares: the seat transaction waited its five
 * seconds for a held departure and gave up (`isLockWaitRefusal`). Shared
 * because the words are the same everywhere ("busy, tap again"), so each
 * landing page maps this one code to `seatDiver.busy`.
 */
export const SEAT_BUSY_NOTICE = "seat-busy";

export type SeatSurfaceId = "departure" | "diver";

/**
 * The departure door's counter mode: the diver is standing at the desk for a
 * boat that has not left. It is one door with its own entry and success words,
 * not a third door, and it is open only while `walkInDoorOpen`
 * (src/lib/operational-window.ts) says so — the seat action asks again.
 */
export type SeatWalkInMode = {
  entry: SeatDiverEntry;
  seatedNotice: string;
  seatedWaiverUndeliveredNotice: string;
  seatedIdentityUnconfirmedNotice: string;
  seatedConfirmationSentNotice: string;
};

/** Everything a settle path can be built from. */
export type SeatLanding = {
  shopSlug: string;
  tripId: string;
  personId: string;
  /** The staffer came through the departure door's counter mode. */
  walkIn?: boolean;
};

export type SeatSurface = {
  entry: SeatDiverEntry;
  refusals: SeatDiverRefusalDetail;
  /**
   * Whether hand entry demands an email address. A diver added from a
   * departure is usually being set up for a waiver and a confirmation, so that
   * door asks for one, except in walk-in mode: the counter's rule is that a
   * name is enough (`people.email` is nullable precisely for the diver who
   * just walked up). The diver's own record never asks.
   */
  email: "required" | "optional";
  /** Where a seated diver lands. */
  seatedPath: (landing: SeatLanding) => string;
  /** Where a refusal or an unparseable submission lands. */
  refusedPath: (landing: SeatLanding) => string;
  /**
   * What the `?gate=` signature is bound to on this surface — the id the
   * landing route holds as a path segment, which is the only value its reader
   * can re-derive without trusting the query (src/lib/trip-admission-gate.ts).
   * The trip surfaces bind to the departure; the diver record has no departure
   * in its URL and binds to the person. `null` means this surface never carries
   * the structured detail at all.
   */
  gateScope: (landing: SeatLanding) => TripAdmissionGateScope | null;
  seatedNotice: string;
  /**
   * What the counter's mode of this door says and records instead
   * ({@link SeatWalkInMode}); absent on a door with no counter.
   */
  walkIn?: SeatWalkInMode;
  /**
   * The same seating, when the waiver it triggered could not be emailed —
   * `SeatDiverWaiver`'s `not_delivered` / `failed` (src/db/seat-diver.ts). The
   * diver is seated either way, so this is still a success notice; what it adds
   * is the one fact `seatedNotice` would otherwise hide, that nothing went out
   * and the link has to be handed over from the diver's row.
   *
   * Every door needs one. The counter walk-in is not the edge case here — it is
   * the *common* case, since the counter deliberately takes a diver on a name
   * alone and `no_email` is what that produces.
   *
   * A separate notice code rather than a token in the URL: a waiver link is its
   * own capability, and a redirect query is exactly where one must never go
   * (docs/engineering/capability-telemetry-runbook.md). The landing page already
   * carries the real link on the diver's own row, behind `WaiverSendControl` /
   * `WaiverFallbackLink`; this notice points there.
   */
  seatedWaiverUndeliveredNotice: string;
  /**
   * The same seating, when the seat it made is **held** — `createBooking`
   * attached it to an existing person on something short of proof and stamped
   * `identityUnconfirmedAt`, so the boarding gate refuses it until a staffer
   * confirms the identity (H-20260724-one-person-per-email, issue #1556).
   *
   * Still a seating, so still a success code; what it adds is the fact
   * `seatedNotice` hid. Without it every door answered a plain "Added" and the
   * staffer met the hold on the next tap instead — a check-in refusal pointing
   * at a confirm control on the trip roster, which is three screens and a
   * queue away from the counter that made the seat (`dive-domain-expert`,
   * 2026-09-11).
   *
   * Ranked **above** the waiver notice below when both apply: a held seat
   * withholds the matched person's particulars, the waiver control among them
   * (`RosterSection.tsx`'s `showsPersonDetail`), so "hand them the waiver link"
   * is not yet an instruction anyone can follow.
   *
   * Every door needs one, including the diver's own record — which seats a
   * person the staffer already picked by identity and so has never raised the
   * flag. The flag is decided inside `createBooking`, not at the door, and a
   * door with no sentence for it would fall back to "Added", which is the
   * exact hole this closes.
   */
  seatedIdentityUnconfirmedNotice: string;
  /**
   * The same seating, when the departure has not sailed (or, at the counter,
   * is on a later day) and the diver was sent the booking confirmation (`SeatDiverConfirmation`'s `sent`, fourth UX
   * review item 3). "Diver added to the trip." left the staffer guessing
   * whether a phone booker had been told anything; this says they were.
   */
  seatedConfirmationSentNotice: string;
  /**
   * Whether the settle URL carries the new booking id — the roster's
   * scroll-to-the-new-row-and-toast affordance. Surfaces without a roster to
   * scroll leave it off rather than trailing a meaningless query param.
   */
  carriesBookingId: boolean;
  invalidNotice: string;
  /** Exhaustive by type: a new refusal code cannot reach a page wordless. */
  refusalNotice: Record<SeatDiverRefusal, string>;
};

/**
 * Every path below is built with `shopPath`, which escapes each segment.
 *
 * A `SeatLanding` is built from raw form fields precisely when zod *failed* —
 * the staffer must still land back on the page they submitted from — so the
 * segments here are, on that path, unvalidated submitted values. No path here
 * can become an open redirect (each starts with a literal `/shop/`), but an id
 * carrying `?`, `#`, or a slash would still rewrite the query the notice is
 * appended to, or point at a different route than the one named. This used to
 * be a local `segment()` helper doing the same job; it is `shopPath`'s job now
 * (src/lib/staff-notices.ts), so every staff URL in the app escapes the same
 * way.
 */
const tripPath = ({ shopSlug, tripId }: SeatLanding) => shopPath(shopSlug, "trips", tripId);

/**
 * The one refusal vocabulary a boat's page speaks — one distinct notice per
 * gate, for the roster's Add diver and the counter's walk-in alike (the
 * counter once kept a second, parallel map of the same twelve refusals).
 */
const TRIP_REFUSAL_NOTICE: Record<SeatDiverRefusal, string> = {
  trip_full: "diver-full",
  divers_full: "diver-divers-full",
  participant_type_unavailable: "diver-type-unavailable",
  already_booked: "diver-already",
  course_unstaffed: "diver-course-unstaffed",
  course_prerequisite: "diver-course-prerequisite",
  course_ratio_full: "diver-course-ratio-full",
  course_min_age: "diver-course-min-age",
  // The boat's own cert/specialty/nitrox gate, distinct from a *course's*
  // admission rule above: this diver's cards can't reach what the trip and its
  // sites demand, and the staffer's next move is a different one (DOM-M6).
  trip_prerequisite: "diver-trip-prerequisite",
  trip_unavailable: "diver-unavailable",
  date_request_offer_unavailable: "diver-date-request-unavailable",
  date_request_departure_conflict: "diver-date-request-conflict",
  date_request_party_full: "diver-date-request-full",
  person_not_found: "diver-unavailable",
  unavailable: "diver-unavailable",
};

export const SEAT_SURFACES: Record<SeatSurfaceId, SeatSurface> = {
  /**
   * **From a departure**: the roster's hand entry and returning-diver picker,
   * the global Add booking once a boat is chosen, and the counter's walk-in.
   * Seated or refused, the staffer lands on that boat's Divers tab, where the
   * add-diver form and the signed `?gate=` sentence both live.
   *
   * The counter is a mode of this door: a name on its own is enough (so the
   * email is optional in walk-in mode, `people.email` being nullable for the
   * diver who just walked up), and the seat is told as a walk-in. It used to
   * be a page of its own, and before that spoke a deliberately blunt three-code
   * vocabulary (`refusals: "coarse"`); naming the reason ("This boat is full")
   * is both shorter and useful, and now there is one place that words it.
   */
  departure: {
    entry: "roster",
    refusals: "specific",
    email: "required",
    seatedPath: tripPath,
    refusedPath: tripPath,
    gateScope: ({ tripId }) => (tripId ? { kind: "trip", id: tripId } : null),
    seatedNotice: "diver-added",
    seatedWaiverUndeliveredNotice: "diver-added-waiver-undelivered",
    seatedIdentityUnconfirmedNotice: "diver-added-identity-unconfirmed",
    seatedConfirmationSentNotice: "diver-added-confirmed",
    walkIn: {
      entry: "walk_in",
      seatedNotice: "walkin-added",
      seatedWaiverUndeliveredNotice: "walkin-added-waiver-undelivered",
      seatedIdentityUnconfirmedNotice: "walkin-added-identity-unconfirmed",
      seatedConfirmationSentNotice: "walkin-added-confirmed",
    },
    carriesBookingId: true,
    invalidNotice: "diver-seat-invalid",
    refusalNotice: TRIP_REFUSAL_NOTICE,
  },
  /**
   * **From a diver**: "Book on an upcoming trip", from a diver's own record.
   * Stays on the record — the staffer is working that one diver, not that one
   * boat.
   */
  diver: {
    entry: "roster",
    refusals: "specific",
    email: "optional",
    seatedPath: ({ shopSlug, personId }) => shopPath(shopSlug, "divers", personId),
    refusedPath: ({ shopSlug, personId }) => shopPath(shopSlug, "divers", personId),
    // The one door with no departure in its landing URL: it binds the
    // signature to the diver whose record is about to render the sentence.
    gateScope: ({ personId }) => ({ kind: "diver", id: personId }),
    seatedNotice: "booked",
    seatedWaiverUndeliveredNotice: "booked-waiver-undelivered",
    seatedIdentityUnconfirmedNotice: "booked-identity-unconfirmed",
    seatedConfirmationSentNotice: "booked-confirmed",
    carriesBookingId: false,
    invalidNotice: "booking-invalid",
    refusalNotice: {
      trip_full: "trip-full",
      divers_full: "divers-full",
      participant_type_unavailable: "type-unavailable",
      already_booked: "already-booked",
      course_unstaffed: "course-unstaffed",
      course_prerequisite: "course-prerequisite",
      course_ratio_full: "course-ratio-full",
      course_min_age: "course-min-age",
      trip_prerequisite: "trip-prerequisite",
      trip_unavailable: "trip-unavailable",
      date_request_offer_unavailable: "trip-unavailable",
      date_request_departure_conflict: "trip-unavailable",
      date_request_party_full: "trip-unavailable",
      person_not_found: "booking-invalid",
      unavailable: "trip-unavailable",
    },
  },
};

/**
 * The door as the staffer came through it: the counter's entry and words when
 * they asked for the counter on a door that has one, the door's own otherwise.
 */
export function seatSurfaceFor(surface: SeatSurface, landing: SeatLanding): SeatSurface {
  return landing.walkIn && surface.walkIn ? { ...surface, ...surface.walkIn } : surface;
}
