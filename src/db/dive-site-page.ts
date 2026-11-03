import type { AppDb } from "./client";
import {
  getDiveSite,
  getDiveSiteTemplateUpdate,
  listDiveSiteCreatures,
  listUpcomingTripsForSite,
} from "./dive-sites";
import { listTripDives } from "./trips";

/**
 * The dive site page's question in one call: the site, its upcoming
 * departures, its creatures and any template update, and the dives of the
 * soonest `tideDepartures` departures when the site carries a tide station
 * (their tide lines are drawn from them). Null when the site is not this
 * shop's live row.
 */
export async function getDiveSitePage(
  db: AppDb,
  shopId: string,
  siteId: string,
  options: { tideDepartures: number },
) {
  const site = await getDiveSite(db, shopId, siteId);
  if (!site) return null;
  const [upcomingTrips, creatures, templateUpdate] = await Promise.all([
    listUpcomingTripsForSite(db, shopId, siteId),
    listDiveSiteCreatures(db, shopId, siteId),
    getDiveSiteTemplateUpdate(db, shopId, siteId),
  ]);
  const tideTrips = site.tideStationId ? upcomingTrips.slice(0, options.tideDepartures) : [];
  const tideDives = await Promise.all(
    tideTrips.map(async (trip) => ({ trip, dives: await listTripDives(db, shopId, trip.tripId) })),
  );
  return { site, upcomingTrips, creatures, templateUpdate, tideDives };
}
