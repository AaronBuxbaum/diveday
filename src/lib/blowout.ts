import type { CertRequirementSource, SiteCertRequirement } from "./readiness";
import { decideTripAdmission, type TripAdmissionEvidence } from "./trip-admission";

/**
 * **Which departures a blown-out diver should actually be offered.**
 *
 * When the captain calls a weather blow-out (glossary, ADR
 * 20260804-blowout-cascade), every booked diver gets one message with
 * rebooking options. The options are worth nothing if half of them are boats
 * the diver would be refused at the counter — so each diver's list is
 * filtered through the *same* booking-time gate every real booking runs,
 * `decideTripAdmission`, never a parallel reimplementation of it. Everything
 * here is pure: the db layer gathers the candidates and the diver's evidence,
 * this module decides.
 *
 * A candidate survives only when the seat is genuinely offerable:
 *
 * - **scheduled and still in the future** — a cancelled or departed trip is
 *   not a plan;
 * - **inside the offer horizon** — a blown-out Saturday diver wants next
 *   week, not next season;
 * - **not the blown-out trip itself**, whatever state the caller passes it in;
 * - **has a free seat** — an offer onto a full boat is a second
 *   disappointment queued behind the first;
 * - **not a course session** — enrolment has its own admission rule
 *   (`course_prerequisite`, prepaid curriculum, multi-day commitment), so a
 *   charter seat is never "replaced" by a class;
 * - **not a trip the diver already holds a seat on** — they don't need a link
 *   to a boat they're already booked on;
 * - **admission-eligible** — `decideTripAdmission` over the trip's own
 *   requirement row, its sites' inherent gates, and the diver's certification
 *   evidence at this shop.
 *
 * Zero survivors is a legitimate answer, not an error: the message still goes
 * out with the cancellation and the money story, pointing at the public
 * schedule instead of a list (the "graceful no-alternatives shape").
 */

/** How far ahead an offer may reach. Weather rebooking is a near-future decision. */
export const BLOWOUT_OFFER_HORIZON_DAYS = 30;

/** At most this many alternatives per diver — a choice, not a catalog. */
export const BLOWOUT_MAX_OFFERS = 3;

/** One departure as the offer computation sees it. */
export type BlowoutCandidateTrip = {
  id: string;
  startsAt: Date;
  status: "scheduled" | "cancelled";
  capacity: number;
  /** Non-cancelled bookings currently holding seats. */
  activeBookings: number;
  /** True when the departure is a scheduled course session (`trips.course_id`). */
  courseSession: boolean;
  /** The trip's own requirement row, or null when the shop configured none. */
  requirement: CertRequirementSource | null;
  /** Every site the trip visits, folded into one gate (`combineSiteRequirements`). */
  siteRequirement: SiteCertRequirement | null;
};

/** One blown-out diver as the offer computation sees them. */
export type BlowoutDiverContext = {
  /** The diver's certification evidence at this shop — the rows admission reads. */
  evidence: TripAdmissionEvidence;
  /** H-13: certs on the record are not provably this person's; admission fails open. */
  identityUnconfirmed: boolean;
  /** Trips this person already actively holds a seat on (any status but cancelled). */
  bookedTripIds: readonly string[];
};

export type BlowoutOfferInput = {
  /** The blown-out trip — never offerable, whatever state its candidate row is in. */
  cancelledTripId: string;
  now: Date;
  candidates: readonly BlowoutCandidateTrip[];
  diver: BlowoutDiverContext;
  horizonDays?: number;
  maxOffers?: number;
};

/**
 * The trip ids this diver should be offered, soonest first, capped at
 * `maxOffers`. Pure and deterministic — same inputs, same offers — which is
 * what makes a resumed cascade reproducible.
 */
export function qualifyingAlternatives(input: BlowoutOfferInput): string[] {
  const horizonDays = input.horizonDays ?? BLOWOUT_OFFER_HORIZON_DAYS;
  const maxOffers = input.maxOffers ?? BLOWOUT_MAX_OFFERS;
  const horizonEnd = input.now.getTime() + horizonDays * 24 * 60 * 60 * 1_000;
  const alreadyBooked = new Set(input.diver.bookedTripIds);

  return input.candidates
    .filter((candidate) => {
      if (candidate.id === input.cancelledTripId) return false;
      if (candidate.status !== "scheduled") return false;
      if (candidate.courseSession) return false;
      const startsAtMs = candidate.startsAt.getTime();
      if (startsAtMs <= input.now.getTime() || startsAtMs > horizonEnd) return false;
      if (candidate.activeBookings >= candidate.capacity) return false;
      if (alreadyBooked.has(candidate.id)) return false;
      return decideTripAdmission({
        requirement: candidate.requirement,
        siteRequirement: candidate.siteRequirement,
        evidence: input.diver.evidence,
        identityUnconfirmed: input.diver.identityUnconfirmed,
      }).admitted;
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, maxOffers)
    .map((candidate) => candidate.id);
}
