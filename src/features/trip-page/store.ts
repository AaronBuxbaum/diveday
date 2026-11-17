import { getBoatById, listBoats } from "@/features/boats";
import { getTripConservationPanel } from "@/features/conservation";
import { getCoursePulse } from "@/features/course-pulse";
import { getTripGuests, type TripGuestsFilters, type TripGuestsShop } from "@/features/trip-guests";
import { listTripLenses } from "@/features/trip-lenses";
import { getTripOverview, type TripOverviewShop } from "@/features/trip-overview";
import { gearToPack, getTripPrep, type TripPrepShop } from "@/features/trip-prep";
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
 * readiness and prep list (`./trip-shared-reads`), the latest stage and what
 * the reader may do. Details-only inputs have a separate deferred reader. `null` when there is no such departure in this shop.
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
  const [overview, guests, refund, stage, coursePulse, retireMedicalRefusal] = await Promise.all([
    getTripOverview(db, shop, tripId, personId, undefined, sharedReads),
    getTripGuests(db, shop, tripId, input.filters, sharedReads),
    canPersonRefund(db, shop.id, personId),
    latestTripStage(db, shop.id, tripId),
    getCoursePulse(db, shop.id, tripId, personId, sharedReads),
    // Who may give a refused seat a fresh release; the action re-checks.
    canPersonRetireMedicalRefusal(db, shop.id, personId),
  ]);
  if (!overview || !guests) return null;
  return {
    overview,
    coursePulse,
    guests,
    stage,
    can: { refund, retireMedicalRefusal },
  };
}

/** Read only after the page resolves its actual tab, including save notices. */
export async function getTripDetails(
  db: AppDb,
  shop: TripManifestShop,
  tripId: string,
  personId: string,
) {
  const [boats, lenses, conservation] = await Promise.all([
    shop.hasBoatDiving ? listBoats(db, shop.id) : [],
    listTripLenses(db, shop.id),
    getTripConservationPanel(db, shop.id, tripId, personId),
  ]);
  return { boats, lenses, conservation };
}

/** Start the page's independent reads together; the phase-only reads wait until a phase asks. */
export function readTripPage(
  db: AppDb,
  shop: TripManifestShop & TripPrepShop,
  tripId: string,
  input: Parameters<typeof getTripManifest>[3],
) {
  return {
    manifest: getTripManifest(db, shop, tripId, input),
    details: () => getTripDetails(db, shop, tripId, input.session.user.personId),
    /** The departure's boat, for the header's facts line; null for a shore dive or a pool session. */
    boat: (boatId: string | null) => (boatId ? getBoatById(db, shop.id, boatId) : null),
    /** Getting ready's and Check-in's summary of the Gear page's packing list. */
    gearToPack: async () => {
      const prep = await getTripPrep(db, shop, tripId);
      return prep ? gearToPack(prep) : null;
    },
  };
}
