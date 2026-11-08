import { listBoats } from "@/features/boats";
import { getTripConservationPanel } from "@/features/conservation";
import { getCoursePulse } from "@/features/course-pulse";
import { getDepartureNeeds } from "@/features/today";
import { getTripGuests, type TripGuestsFilters, type TripGuestsShop } from "@/features/trip-guests";
import { listTripLenses } from "@/features/trip-lenses";
import { getTripOverview, type TripOverviewShop } from "@/features/trip-overview";
import { loadTripSharedReads } from "@/features/trip-shared-reads";
import { latestTripStage } from "@/features/trip-stages";
import { canPersonRefund, canPersonRetireMedicalRefusal } from "../../db/authz";
import type { AppDb } from "../../db/client";
import type { Role } from "../../lib/authz";

export type TripManifestShop = TripOverviewShop &
  TripGuestsShop & {
    slug: string;
    hasBoatDiving: boolean;
  };

/**
 * The departure page's Divers and Details tabs, in one call (issue #2757): the
 * overview and the guests share one read of the trip, its requirements,
 * readiness and prep list (`./trip-shared-reads`); beside them the fleet and
 * the trip tags for the Details selects, the latest stage, and what the reader
 * may do. `null` when there is no such departure in this shop.
 *
 * `readTripPage` composes this manifest with Today's departure queue now
 * that both readers live above the database substrate.
 */
export async function getTripManifest(
  db: AppDb,
  shop: TripManifestShop,
  tripId: string,
  input: {
    session: { user: { personId: string; roles: readonly Role[] } };
    filters: TripGuestsFilters;
  },
) {
  const personId = input.session.user.personId;
  const sharedReads = loadTripSharedReads(db, shop.id, tripId);
  const [
    overview,
    guests,
    boats,
    lenses,
    refund,
    stage,
    coursePulse,
    conservation,
    retireMedicalRefusal,
  ] = await Promise.all([
    getTripOverview(db, shop, tripId, personId, undefined, sharedReads),
    getTripGuests(db, shop, tripId, input.filters, sharedReads),
    // The fleet, for the Details form's hull select. Live hulls only: this is
    // a picker for what the departure will sail on, not a record of what it
    // did (`listBoatsForHistory` is the other one).
    shop.hasBoatDiving ? listBoats(db, shop.id) : [],
    // The shop's trip tags, for the select beside the hull (ADR
    // 20260904-reef-all-the-way-down, decision 2).
    listTripLenses(db, shop.id),
    canPersonRefund(db, shop.id, personId),
    latestTripStage(db, shop.id, tripId),
    getCoursePulse(db, shop.id, tripId, personId, sharedReads),
    getTripConservationPanel(db, shop.id, tripId, personId),
    // Who may give a refused seat a fresh release; the action re-checks.
    canPersonRetireMedicalRefusal(db, shop.id, personId),
  ]);
  if (!overview || !guests) return null;
  return {
    overview,
    coursePulse,
    conservation,
    guests,
    boats,
    lenses,
    stage,
    can: { refund, retireMedicalRefusal },
  };
}

/** Start the page's independent reads together; keep the queue deferred until the pulse needs it. */
export function readTripPage(
  db: AppDb,
  shop: TripManifestShop & Parameters<typeof getDepartureNeeds>[1],
  tripId: string,
  input: Parameters<typeof getTripManifest>[3] &
    Parameters<typeof getDepartureNeeds>[3] & { details: boolean },
) {
  return {
    manifest: getTripManifest(db, shop, tripId, input),
    departureNeeds: input.details ? null : getDepartureNeeds(db, shop, tripId, input),
  };
}
