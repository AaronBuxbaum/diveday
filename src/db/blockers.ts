import { annotateAlsoOn, type BlockerQueueTrip, blockerFixFor } from "@/lib/blockers";
import { nowDate } from "@/lib/clock";
import type { AppDb } from "./client";
import { listTripReadiness } from "./readiness";
import { upcomingTripsWithCounts } from "./trips";

/**
 * How many upcoming departures the queue inspects. Readiness is a per-trip
 * roll-up, so this bounds the work; a shop with more scheduled departures than
 * this is warned that the tail is not shown rather than silently truncated.
 */
const MAX_TRIPS = 40;

export type BlockerQueue = {
  trips: BlockerQueueTrip[];
  /** True when there are more upcoming departures than were inspected. */
  truncated: boolean;
};

/**
 * Every diver who can't board yet, grouped by the departure that holds them up,
 * across all upcoming trips. Trips with no blocked diver are omitted — the
 * queue is a list of problems, not a schedule.
 */
export async function getBlockerQueue(
  db: AppDb,
  shopId: string,
  shopSlug: string,
  now: Date = nowDate(),
): Promise<BlockerQueue> {
  const upcoming = await upcomingTripsWithCounts(db, shopId, now);
  const inspected = upcoming.slice(0, MAX_TRIPS);
  const readinessByTrip = new Map(
    await Promise.all(
      inspected.map(
        async (trip) => [trip.id, await listTripReadiness(db, shopId, trip.id)] as const,
      ),
    ),
  );

  const trips: BlockerQueueTrip[] = [];
  for (const trip of inspected) {
    const rows = readinessByTrip.get(trip.id) ?? [];
    const divers = rows
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => ({
        bookingId: row.booking.id,
        personId: row.person.id,
        fullName: row.person.fullName,
        blockers: [...row.readiness.blockers],
        // Every blocked row has at least one blocker, so a fix always resolves.
        fix: blockerFixFor(row.readiness.blockers, {
          shopSlug,
          tripId: trip.id,
          personId: row.person.id,
          bookingId: row.booking.id,
          fullName: row.person.fullName,
        }) ?? {
          label: "Open roster",
          href: `/shop/${shopSlug}/trips/${trip.id}/guests`,
          sendsWaiver: false,
          bookingId: row.booking.id,
        },
        // Filled once the whole queue is built (a repeat diver spans trips).
        alsoOn: [],
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (divers.length === 0) continue;
    trips.push({
      tripId: trip.id,
      title: trip.title,
      startsAt: trip.startsAt,
      courseTitle: trip.course?.title ?? null,
      booked: trip.booked,
      ready: rows.filter((row) => row.readiness.status === "ready").length,
      divers,
    });
  }

  annotateAlsoOn(trips);
  return { trips, truncated: upcoming.length > inspected.length };
}
