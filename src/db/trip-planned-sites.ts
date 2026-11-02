import { asc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "./client";
import { diveSites, tripDives } from "./schema";

/** One planned dive's site as a card or a forecast reads it. */
export type PlannedDiveSite = {
  id: string;
  name: string;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
};

/**
 * **Every site each departure plans to dive, distinct and in dive order**,
 * keyed by trip (ADR 20260719-trip-dive-briefings). `tripPrimarySiteId` answers
 * "where is this boat headed" with one site; a two-site morning such as
 * Molasses then French needs both. A dive with no site yet adds nothing, and a
 * trip with no chosen site has no entry. One query for the whole day.
 */
export async function plannedSitesByTrip(
  db: AppDb,
  tripIds: readonly string[],
): Promise<Map<string, PlannedDiveSite[]>> {
  const byTrip = new Map<string, PlannedDiveSite[]>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      tripId: tripDives.tripId,
      id: diveSites.id,
      name: diveSites.name,
      forecastLatitude: diveSites.forecastLatitude,
      forecastLongitude: diveSites.forecastLongitude,
    })
    .from(tripDives)
    .innerJoin(diveSites, eq(diveSites.id, tripDives.diveSiteId))
    .where(inArray(tripDives.tripId, [...tripIds]))
    .orderBy(asc(tripDives.tripId), asc(tripDives.diveNumber));
  for (const { tripId, ...site } of rows) {
    const list = byTrip.get(tripId) ?? [];
    if (!list.some((seen) => seen.id === site.id)) list.push(site);
    byTrip.set(tripId, list);
  }
  return byTrip;
}
