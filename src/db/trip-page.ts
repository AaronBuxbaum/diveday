import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { canPersonRefund, canPersonRetireMedicalRefusal } from "./authz";
import { listBoats } from "./boats";
import type { AppDb } from "./client";
import { getDepartureNeeds } from "./today-departure-needs";
import { getTripGuests, type TripGuestsFilters, type TripGuestsShop } from "./trip-guests";
import { listTripLenses } from "./trip-lenses";
import { getTripOverview, type TripOverviewShop } from "./trip-overview";
import { loadTripSharedReads } from "./trip-shared-reads";
import { latestTripStage } from "./trip-stages";

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
 * The departure's needs (Today's queue, filtered to this boat) start with
 * everything else and are only waited on when the overview says the pulse
 * needs them; the Details tab never asks.
 */
export async function getTripManifest(
  db: AppDb,
  shop: TripManifestShop,
  tripId: string,
  input: {
    session: { user: { personId: string; roles: readonly Role[] } };
    now: Date;
    t: StaffTranslator;
    locale: string;
    /** `"details"` skips the departure's needs. */
    view?: string;
    filters: TripGuestsFilters;
  },
) {
  const { session, now, t, locale } = input;
  const personId = session.user.personId;
  const sharedReads = loadTripSharedReads(db, shop.id, tripId);
  const needs =
    input.view === "details"
      ? null
      : getDepartureNeeds(db, shop, tripId, { now, t, locale, session });
  const [overview, guests, boats, lenses, refund, stage, retireMedicalRefusal] = await Promise.all([
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
    // Who may give a refused seat a fresh release; the action re-checks.
    canPersonRetireMedicalRefusal(db, shop.id, personId),
  ]);
  if (!overview || !guests) return null;
  return {
    overview,
    guests,
    boats,
    lenses,
    stage,
    needs: overview.pulseNeeded ? await needs : null,
    can: { refund, retireMedicalRefusal },
  };
}
