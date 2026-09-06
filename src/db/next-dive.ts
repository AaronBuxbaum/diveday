import { nowDate } from "@/lib/clock";
import type { NextDiveCandidate, NextDivePick } from "@/lib/next-dive";
import { pickNextDive } from "@/lib/next-dive";
import { decideTripAdmission } from "@/lib/trip-admission";
import { readCertificationEvidence } from "./certification-evidence";
import type { AppDb } from "./client";
import { tripRequirementSummaries } from "./readiness";
import { getTripLens } from "./trip-lenses";
import { pagedUpcomingTripsWithCounts } from "./trips";

/**
 * How far down the board one recap looks. Enough for a reason to fire, small
 * enough that the two requirement reads behind it stay one page rather than a
 * fan-out — `tripRequirementSummaries` answers for the whole window in two
 * queries, so the cost of this number is the row scan and nothing more.
 *
 * A busy shop whose next twelve departures are all the same charter degrades to
 * `soonest_with_room`, which is honest and dull rather than wrong; widening it
 * would buy a better reason on exactly the boards where a diver has the least
 * trouble finding one.
 */
export const NEXT_DIVE_CANDIDATE_WINDOW = 12;

/**
 * **The one departure the recap points a diver at** (D35, issue #1195) — the
 * database half of `src/lib/next-dive.ts`, which owns the rules.
 *
 * Two obligations shape every read below.
 *
 * **A card never points at a trip this diver could not dive.** The candidates
 * are put through `decideTripAdmission`, the same booking-time gate
 * `createBookingRecord` runs (src/lib/trip-admission.ts), so a departure
 * demanding Advanced is dropped for an Open Water diver before the ranking ever
 * sees it. Admission rather than readiness on purpose: readiness asks "is this
 * diver cleared *right now*", and an unsigned waiver for a trip three weeks out
 * is not a reason to stop suggesting it.
 *
 * **The evidence is read once.** Twelve candidates would otherwise mean
 * thirty-six certification queries for one keepsake, and the answer is the same
 * every time — it is a fact about the diver, not about the trip.
 *
 * Everything else it inherits: `pagedUpcomingTripsWithCounts` is already
 * `liveTrip()`-filtered, already carries the standing one-hour departure buffer,
 * and `hasSpace` is a `having` over the same booking join it counts with, so a
 * full boat never reaches the card.
 */
export async function nextDiveForBooking(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    /** The departure just dived — never the pick, and the reason rules read it. */
    justDivedTripId: string;
    /** The course that day taught, when it taught one. */
    dayCourseId: string | null;
    /** The crew's own written word for the day (`trips.recap_shoutout`). */
    dayShoutout: string | null;
    /** Every site the day actually went to. */
    daySiteNames: readonly string[];
    /**
     * The shop's own word for the kind of day this was (`trips.lens_id`), or
     * null. Only the id travels: the word is read once below, and only when a
     * day wears one, because `same_lens` fires on an id match and so the
     * matching candidate is wearing that very row.
     */
    dayLensId: string | null;
    now?: Date;
  },
): Promise<NextDivePick | null> {
  const now = input.now ?? nowDate();
  const { trips } = await pagedUpcomingTripsWithCounts(db, input.shopId, {
    publicOnly: true,
    hasSpace: true,
    limit: NEXT_DIVE_CANDIDATE_WINDOW,
    now,
  });
  const upcoming = trips.filter((trip) => trip.id !== input.justDivedTripId);
  if (upcoming.length === 0) return null;

  const [requirements, evidence, dayLens] = await Promise.all([
    tripRequirementSummaries(
      db,
      input.shopId,
      upcoming.map((trip) => trip.id),
    ),
    readCertificationEvidence(db, input.shopId, input.personId),
    // One read, and only for a day that wears a lens at all: every candidate
    // the rule can fire on shares this exact row, so there is no per-candidate
    // name to fetch. A lens the shop has since deleted resolves to null and the
    // rule simply does not fire, which is the right answer — a reason has to be
    // sayable to be given.
    input.dayLensId === null ? null : getTripLens(db, input.shopId, input.dayLensId),
  ]);

  const candidates: NextDiveCandidate[] = [];
  for (const trip of upcoming) {
    const siteRequirement = requirements.get(trip.id) ?? null;
    const admission = decideTripAdmission({
      // The trip's own requirement row is already folded into the summary above
      // — `tripRequirementSummaries` composes it with every site the trip
      // visits, which is the same fold `getTripRequirements` +
      // `getTripSiteRequirement` produce one trip at a time.
      requirement: null,
      siteRequirement,
      evidence,
      // A course session's admission rule is the course's own, enforced in the
      // booking transaction. The itinerary's gate must not be read here for the
      // reason `TripAdmissionInput.courseSession` gives in full: continuing
      // education is taught at the sites it certifies people for.
      courseSession: trip.courseId !== null,
    });
    if (!admission.admitted) continue;
    candidates.push({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      courseId: trip.courseId,
      courseTitle: trip.course?.title ?? null,
      siteName: trip.diveSite?.name ?? null,
      lensId: trip.lensId,
      requiredLevel: siteRequirement?.minimumCertificationLevel ?? null,
      seatsLeft: Math.max(0, trip.capacity - trip.booked),
    });
  }

  return pickNextDive({
    day: {
      justDivedTripId: input.justDivedTripId,
      courseId: input.dayCourseId,
      shoutout: input.dayShoutout,
      siteNames: input.daySiteNames,
      lensId: dayLens?.id ?? null,
      lensName: dayLens?.name ?? null,
    },
    candidates,
  });
}
