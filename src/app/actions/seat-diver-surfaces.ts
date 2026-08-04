import type { SeatDiverEntry, SeatDiverRefusal, SeatDiverRefusalDetail } from "@/db/seat-diver";
import type { TripAdmissionGateScope } from "@/lib/trip-admission-gate";

/**
 * The per-door half of seating a diver (`src/db/seat-diver.ts` owns the other
 * half — the consequences, which are identical everywhere).
 *
 * What legitimately differs between the four staff doors is *presentation*:
 * where the staffer lands afterwards, which words their page already speaks,
 * and whether a name typed at the desk must come with an email. Those live
 * here as data, one row per surface, so a reviewer can read the whole matrix
 * at once instead of diffing four action files. Kept out of the `"use server"`
 * module beside it — such a module may only export async functions — the same
 * split as `./waiver-send-types.ts`.
 *
 * Notice codes, not sentences: each page still looks these up in its own
 * `?notice=` map against the staff bundle.
 */

export type SeatSurfaceId = "trip-guests" | "walk-in" | "diver-record" | "new-booking";

/** Everything a settle path can be built from. */
export type SeatLanding = { shopSlug: string; tripId: string; personId: string };

export type SeatSurface = {
  entry: SeatDiverEntry;
  refusals: SeatDiverRefusalDetail;
  /**
   * Whether hand entry demands an email address. Optional is the counter's
   * rule (`people.email` is nullable precisely for the diver who just walked
   * up); the trip roster keeps asking for one, because a diver added there is
   * usually being set up for a waiver and a confirmation.
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
 * Every id that reaches a path template goes through this first.
 *
 * A `SeatLanding` is built from raw form fields precisely when zod *failed* —
 * the staffer must still land back on the page they submitted from — so the
 * segments below are, on that path, unvalidated submitted values. No template
 * here can become an open redirect (each starts with a literal `/shop/`), but
 * an id carrying `?`, `#`, or a slash would still rewrite the query the notice
 * is appended to, or point at a different route than the one named.
 */
const segment = (value: string) => encodeURIComponent(value);

const guestsPath = ({ shopSlug, tripId }: SeatLanding) =>
  `/shop/${segment(shopSlug)}/trips/${segment(tripId)}/guests`;

/** The trip page's vocabulary — one distinct notice per gate. */
const TRIP_REFUSAL_NOTICE: Record<SeatDiverRefusal, string> = {
  trip_full: "diver-full",
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
  person_not_found: "diver-unavailable",
  unavailable: "diver-unavailable",
};

export const SEAT_SURFACES: Record<SeatSurfaceId, SeatSurface> = {
  /** The trip's Guests tab — hand entry and the returning-diver picker. */
  "trip-guests": {
    entry: "roster",
    refusals: "specific",
    email: "required",
    seatedPath: guestsPath,
    refusedPath: guestsPath,
    gateScope: ({ tripId }) => ({ kind: "trip", id: tripId }),
    seatedNotice: "diver-added",
    seatedWaiverUndeliveredNotice: "diver-added-waiver-undelivered",
    carriesBookingId: true,
    invalidNotice: "diver-invalid",
    refusalNotice: TRIP_REFUSAL_NOTICE,
  },
  /**
   * The counter walk-in. Settles on the check-in queue, where the diver the
   * staffer just added is the next row to work, and speaks the deliberately
   * blunt three-code vocabulary that pairs with `refusals: "coarse"`.
   */
  "walk-in": {
    entry: "walk_in",
    refusals: "coarse",
    email: "optional",
    seatedPath: ({ shopSlug }) => `/shop/${segment(shopSlug)}/check-in`,
    refusedPath: ({ shopSlug }) => `/shop/${segment(shopSlug)}/check-in`,
    // `refusals: "coarse"` collapses every gate to one blunt line, so the
    // structured detail is dropped rather than trailing an unreadable param on
    // the queue's URL.
    gateScope: () => null,
    seatedNotice: "walkin_added",
    seatedWaiverUndeliveredNotice: "walkin_added_waiver_undelivered",
    carriesBookingId: true,
    invalidNotice: "walkin_invalid",
    refusalNotice: {
      trip_full: "walkin_full",
      already_booked: "walkin_already",
      course_unstaffed: "walkin_unavailable",
      course_prerequisite: "walkin_unavailable",
      course_ratio_full: "walkin_unavailable",
      course_min_age: "walkin_unavailable",
      trip_prerequisite: "walkin_unavailable",
      trip_unavailable: "walkin_unavailable",
      person_not_found: "walkin_unavailable",
      unavailable: "walkin_unavailable",
    },
  },
  /**
   * "Book on an upcoming trip", from a diver's own record. Stays on the
   * record — the staffer is working that one diver, not that one boat.
   */
  "diver-record": {
    entry: "roster",
    refusals: "specific",
    email: "optional",
    seatedPath: ({ shopSlug, personId }) =>
      `/shop/${segment(shopSlug)}/divers/${segment(personId)}`,
    refusedPath: ({ shopSlug, personId }) =>
      `/shop/${segment(shopSlug)}/divers/${segment(personId)}`,
    // The one surface with no departure in its landing URL: it binds the
    // signature to the diver whose record is about to render the sentence.
    gateScope: ({ personId }) => ({ kind: "diver", id: personId }),
    seatedNotice: "booked",
    seatedWaiverUndeliveredNotice: "booked-waiver-undelivered",
    carriesBookingId: false,
    invalidNotice: "booking-invalid",
    refusalNotice: {
      trip_full: "trip_full",
      already_booked: "already_booked",
      course_unstaffed: "course_unstaffed",
      course_prerequisite: "course_prerequisite",
      course_ratio_full: "course_ratio_full",
      course_min_age: "course_min_age",
      trip_prerequisite: "trip_prerequisite",
      trip_unavailable: "trip_unavailable",
      person_not_found: "booking-invalid",
      unavailable: "trip_unavailable",
    },
  },
  /**
   * The global "Add a booking" door. The only surface whose success and
   * refusal part ways: a seated diver belongs on the trip's Guests tab with
   * the roster's usual toast, while a refusal stays on the form that produced
   * it, boat still chosen, so the staffer can pick someone else.
   *
   * The chosen departure is a path segment there, which is what lets the
   * refusal add only its own `?notice=` to a query-less URL — the shape every
   * other door's refusal already uses, and the one a server-action redirect
   * actually lands on (see the page's docstring for what appending a second
   * param to an already-queried URL did instead).
   */
  "new-booking": {
    entry: "roster",
    refusals: "specific",
    email: "optional",
    seatedPath: guestsPath,
    refusedPath: ({ shopSlug, tripId }) =>
      tripId
        ? `/shop/${segment(shopSlug)}/bookings/new/${segment(tripId)}`
        : `/shop/${segment(shopSlug)}/bookings/new`,
    gateScope: ({ tripId }) => (tripId ? { kind: "trip", id: tripId } : null),
    seatedNotice: "diver-added",
    seatedWaiverUndeliveredNotice: "diver-added-waiver-undelivered",
    carriesBookingId: true,
    invalidNotice: "diver-invalid",
    refusalNotice: TRIP_REFUSAL_NOTICE,
  },
};
