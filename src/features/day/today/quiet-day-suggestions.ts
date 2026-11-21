import type { AppDb } from "@/db/client";
import { listTripsReadiness } from "@/db/readiness";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { DAY_MS } from "@/lib/clock";
import { isTurnedAwaySeat } from "@/lib/manifests";
import { OPERATIONAL_MAX_TRIPS, operationalWindow } from "@/lib/operational-window";

/**
 * **A quiet day's suggestions** (issue #4257). A quiet day has nothing waiting
 * inside the queue's one-week horizon (`spineIsQuiet`), so the useful work it
 * can offer lies just past it: the boats of the week after that already carry
 * a blocked diver. Starting on their waivers and cards today is the head start
 * the horizon cannot give.
 *
 * At most two, soonest first, and none when nothing is blocked: the quiet day
 * stays calm, and a suggestion is always a boat with a real name to clear.
 */
export const QUIET_DAY_SUGGESTION_LIMIT = 2;

/** How far past the horizon the suggestions look: the week after. */
const QUIET_DAY_SUGGESTION_REACH_MS = 7 * DAY_MS;

export type QuietDaySuggestion = {
  tripId: string;
  title: string;
  startsAt: Date;
  /** Bookings on that boat whose readiness is blocked. */
  blocked: number;
};

export function quietDaySuggestions(
  trips: readonly { id: string; title: string; startsAt: Date }[],
  blockedByTrip: ReadonlyMap<string, number>,
  limit = QUIET_DAY_SUGGESTION_LIMIT,
): QuietDaySuggestion[] {
  return trips
    .map((trip) => ({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      blocked: blockedByTrip.get(trip.id) ?? 0,
    }))
    .filter((suggestion) => suggestion.blocked > 0)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, limit);
}

/**
 * The departures of the week past the horizon and their blocked divers, read
 * through the same readiness pass the queue uses, so a boat named here shows
 * the same blocked count once it comes inside the horizon.
 */
export async function readQuietDaySuggestions(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<QuietDaySuggestion[]> {
  const { to: horizon } = operationalWindow(now);
  const { trips } = await pagedUpcomingTripsWithCounts(db, shopId, {
    now,
    from: horizon,
    monthEnd: new Date(horizon.getTime() + QUIET_DAY_SUGGESTION_REACH_MS),
    limit: OPERATIONAL_MAX_TRIPS,
  });
  if (trips.length === 0) return [];
  const rows = await listTripsReadiness(
    db,
    shopId,
    trips.map((trip) => trip.id),
    now,
  );
  const blockedByTrip = new Map<string, number>();
  for (const row of rows) {
    // A seat the desk turned away is nobody's work (issue #2907).
    if (isTurnedAwaySeat(row.booking) || row.readiness.status !== "blocked") continue;
    blockedByTrip.set(row.booking.tripId, (blockedByTrip.get(row.booking.tripId) ?? 0) + 1);
  }
  return quietDaySuggestions(trips, blockedByTrip);
}
