import type { AppDb } from "./client";
import { getTripRequirements, getTripSiteRequirement, listTripReadiness } from "./readiness";
import { listTripPrepDivers } from "./rental-fit";
import { getTripWithBooked } from "./trips";

/**
 * **The five reads the trip page's Overview and Guests both need**, read once
 * (app audit 2026-10-07, item 3).
 *
 * `getTripOverview` and `getTripGuests` each began by reading the trip row and
 * then, inside their own fan-outs, the trip's requirements, its site
 * requirement, its readiness (four statements of its own) and its prep list.
 * The trip page renders both side by side, so it paid for every one of those
 * twice - eight statements of about sixty-five. Each reader still reads them
 * itself when it is called alone (the print packet calls Overview by itself);
 * the page reads them here once and hands the same answer to both, so the
 * pulse on Overview and the roster on Guests can never be drawn from two
 * different readings of one boat.
 *
 * The whole answer is `null` when the departure does not exist, as
 * `getTripWithBooked` answers; both readers then return `null` as before.
 */
export type TripSharedReads = {
  trip: NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
  requirement: Awaited<ReturnType<typeof getTripRequirements>>;
  siteRequirement: Awaited<ReturnType<typeof getTripSiteRequirement>>;
  readiness: Awaited<ReturnType<typeof listTripReadiness>>;
  prepDivers: Awaited<ReturnType<typeof listTripPrepDivers>>;
};

/** Read {@link TripSharedReads} for one departure, all five at once. */
export async function loadTripSharedReads(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripSharedReads | null> {
  const trip = await getTripWithBooked(db, shopId, tripId);
  if (!trip) return null;
  const [requirement, siteRequirement, readiness, prepDivers] = await Promise.all([
    getTripRequirements(db, shopId, tripId),
    getTripSiteRequirement(db, shopId, tripId),
    listTripReadiness(db, shopId, tripId),
    listTripPrepDivers(db, shopId, tripId),
  ]);
  return { trip, requirement, siteRequirement, readiness, prepDivers };
}
