import { canPersonEditDiveSiteAdmission } from "./authz";
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
 * (their tide lines are drawn from them), and whether the reader may change
 * the site's admission fields (issue #3706). Null when the site is not this
 * shop's live row.
 */
export async function getDiveSitePage(
  db: AppDb,
  shopId: string,
  siteId: string,
  options: { tideDepartures: number; personId: string },
) {
  const site = await getDiveSite(db, shopId, siteId);
  if (!site) return null;
  const [upcomingTrips, creatures, templateUpdate, mayEditAdmission] = await Promise.all([
    listUpcomingTripsForSite(db, shopId, siteId),
    listDiveSiteCreatures(db, shopId, siteId),
    getDiveSiteTemplateUpdate(db, shopId, siteId),
    canPersonEditDiveSiteAdmission(db, shopId, options.personId),
  ]);
  const tideTrips = site.tideStationId ? upcomingTrips.slice(0, options.tideDepartures) : [];
  const tideDives = await Promise.all(
    tideTrips.map(async (trip) => ({ trip, dives: await listTripDives(db, shopId, trip.tripId) })),
  );
  return { site, upcomingTrips, creatures, templateUpdate, tideDives, mayEditAdmission };
}
