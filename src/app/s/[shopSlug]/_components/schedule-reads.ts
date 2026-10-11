import type { AppDb } from "@/db/client";
import { tripRequirementSummaries } from "@/db/readiness";
import { countShopTrips, tripDiveSiteSummaries } from "@/db/trips";

/**
 * **Has this shop ever run a departure** — which is not what `hasUpcoming` asks.
 *
 * `upcomingScheduleRange` is scheduled, public, and ahead of now, so it goes false for a shop
 * between seasons with three hundred departures behind it, and for one whose whole board is
 * currently private. The deal list stands down on that signal, and standing it down for those two
 * shops is backwards: an off-season visitor is exactly the person worth telling when a boat needs
 * to fill seats at a discount. The count only runs in the rare case the cheap signal already says
 * no.
 */
export async function everHadDepartureRead(
  db: AppDb,
  shopId: string,
  hasUpcoming: boolean,
): Promise<boolean> {
  return hasUpcoming || (await countShopTrips(db, shopId)) > 0;
}

/** What the schedule's cards say about each listed departure, one read each for the page. */
export function listedDepartureSummaries(db: AppDb, shopId: string, tripIds: string[]) {
  return Promise.all([
    // Where each departure actually goes, read off the *dives* rather than `trips.dive_site_id`
    // (dive one's site, copied onto the trip row), so a two-site day names both and a day whose
    // open tank is the first one still names the site it visits.
    tripDiveSiteSummaries(db, shopId, tripIds),
    // What each departure asks of anybody — the trip's own gate folded with every site it visits.
    // A property of the *trip*, so it is safe on an anonymous page: it says nothing about any
    // reader, and the map holds only the departures that demand something (issue #695).
    tripRequirementSummaries(db, shopId, tripIds),
  ]);
}
