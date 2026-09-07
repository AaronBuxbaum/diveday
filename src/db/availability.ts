import { type AvailabilityTripInput, availabilityWindow } from "@/lib/availability";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { tripRequirementSummaries } from "./readiness";
import { pagedUpcomingTripsWithCounts, tripDiveSiteSummaries } from "./trips";

/**
 * The most departures one document carries. A shop running a boat an hour
 * for fourteen days is 168; the cap exists so a runaway seed can never turn
 * a discovery document into a dump, not because any shop approaches it.
 */
export const AVAILABILITY_TRIP_LIMIT = 200;

/**
 * **The rows behind a shop's availability document** (issue #1427) — the
 * public schedule page's own reads, composed once for a reader that is not a
 * person. Same scope as the page: scheduled, not private, at least one seat,
 * inside the window; then the sites off the dives and the gate off the trip
 * and every site it visits, one read each for the whole list rather than one
 * per row. `availabilityDocument` (src/lib/availability.ts) applies the seat
 * and window tests again and writes the shape.
 *
 * Deliberately no new query: `pagedUpcomingTripsWithCounts` is what the
 * schedule shows an anonymous visitor, and an agent should never be told
 * about a departure the page would not show. `monthStart: now` pins the lower
 * bound to the instant rather than the page's hour of grace for a boat that
 * is late leaving — a seat on a boat already at the dock is not one an agent
 * can sell.
 */
export async function publicAvailabilityTrips(
  db: AppDb,
  shop: { id: string; timezone: string },
  now: Date = nowDate(),
): Promise<AvailabilityTripInput[]> {
  const window = availabilityWindow(now, shop.timezone);
  const { trips } = await pagedUpcomingTripsWithCounts(db, shop.id, {
    now,
    monthStart: window.from,
    monthEnd: window.to,
    hasSpace: true,
    publicOnly: true,
    limit: AVAILABILITY_TRIP_LIMIT,
  });
  const ids = trips.map((trip) => trip.id);
  const [sitesByTrip, requirementsByTrip] = await Promise.all([
    tripDiveSiteSummaries(db, shop.id, ids),
    tripRequirementSummaries(db, shop.id, ids),
  ]);
  return trips.map((trip) => ({
    id: trip.id,
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    capacity: trip.capacity,
    booked: trip.booked,
    priceCents: trip.priceCents,
    conditionsHold: trip.conditionsHold,
    sites: (sitesByTrip.get(trip.id)?.sites ?? []).map((site) => site.name),
    requirement: requirementsByTrip.get(trip.id) ?? null,
  }));
}
