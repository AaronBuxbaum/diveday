import { getBoatById, listBoats } from "@/features/crew-and-boats/boats";
import { getCoursePulse } from "@/features/training/course-pulse";
import {
  getTripGuests,
  type TripGuestsFilters,
  type TripGuestsShop,
} from "@/features/trips/trip-guests";
import { listTripLenses } from "@/features/trips/trip-lenses";
import { getTripOverview, type TripOverviewShop } from "@/features/trips/trip-overview";
import { gearToPack, getTripPrep, type TripPrepShop } from "@/features/trips/trip-prep";
import { loadTripSharedReads } from "@/features/trips/trip-shared-reads";
import { latestTripStage } from "@/features/trips/trip-stages";
import { canPersonRefund, canPersonRetireMedicalRefusal } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { mayStartTripIncidentReport } from "../../db/incident-reports";
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
  const [overview, guests, refund, stage, coursePulse, retireMedicalRefusal, reportIncident] =
    await Promise.all([
      getTripOverview(db, shop, tripId, personId, undefined, sharedReads),
      getTripGuests(db, shop, tripId, input.filters, sharedReads),
      canPersonRefund(db, shop.id, personId),
      latestTripStage(db, shop.id, tripId),
      getCoursePulse(db, shop.id, tripId, personId, sharedReads),
      // Who may give a refused seat a fresh release; the action re-checks.
      canPersonRetireMedicalRefusal(db, shop.id, personId),
      // Who the header's More offers "Report an incident"; the action re-checks.
      mayStartTripIncidentReport(db, shop.id, tripId, personId),
    ]);
  if (!overview || !guests) return null;
  return {
    overview,
    coursePulse,
    guests,
    stage,
    can: { refund, retireMedicalRefusal, reportIncident },
  };
}

/**
 * **A run's page under Schedule** (`/schedule/series/[tripId]`, ADR
 * 20261117-trip-page-clock), opened from one of its dates: that date's
 * overview, which carries the run and its off-cadence dates, and whether this
 * staffer may refund, which decides whether a call-off releases card refunds or
 * leaves them for an owner or manager. `null` when there is no such departure
 * in this shop or it is not part of a run.
 */
export async function getSeriesPage(
  db: AppDb,
  shop: TripOverviewShop,
  tripId: string,
  personId: string,
) {
  const [overview, mayRefund] = await Promise.all([
    getTripOverview(db, shop, tripId, personId),
    canPersonRefund(db, shop.id, personId),
  ]);
  const series = overview?.series;
  if (!overview || !series) return null;
  return { overview, series, mayRefund };
}

/** Read only after the page resolves its actual tab, including save notices. */
export async function getTripDetails(db: AppDb, shop: TripManifestShop) {
  const [boats, lenses] = await Promise.all([
    shop.hasBoatDiving ? listBoats(db, shop.id) : [],
    listTripLenses(db, shop.id),
  ]);
  return { boats, lenses };
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
    details: () => getTripDetails(db, shop),
    /** The departure's boat, for the header's facts line; null for a shore dive or a pool session. */
    boat: (boatId: string | null) => (boatId ? getBoatById(db, shop.id, boatId) : null),
    /** Getting ready's and Check-in's summary of the Gear page's packing list. */
    gearToPack: async () => {
      const prep = await getTripPrep(db, shop, tripId);
      return prep ? gearToPack(prep) : null;
    },
  };
}
