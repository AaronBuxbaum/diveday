/**
 * Pure calculation helpers for shop boat resource management and schedule concurrency.
 */

export type TripTimeInterval = {
  startsAt: Date;
  endsAt: Date;
};

/**
 * Calculates the maximum number of overlapping departures (concurrent trips)
 * at any single instant in time.
 *
 * Trips that touch at a boundary (e.g. 11:00 AM end and 11:00 AM start) do not
 * count as overlapping.
 */
export function maxConcurrentTrips(trips: ReadonlyArray<TripTimeInterval>): number {
  if (trips.length <= 1) return trips.length;
  type Event = { time: number; delta: number };
  const events: Event[] = [];
  for (const trip of trips) {
    events.push({ time: trip.startsAt.getTime(), delta: 1 });
    events.push({ time: trip.endsAt.getTime(), delta: -1 });
  }
  // Sort primarily by time. If times are equal, end events (-1) come before start events (+1)
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    if (current > max) {
      max = current;
    }
  }
  return max;
}

/** A departure and the hull it sails on, for the per-boat overlap check. */
export type AssignedTripInterval = TripTimeInterval & {
  /** `undefined` reads the same as `null` here: a departure with no hull. */
  boatId?: string | null;
};

/**
 * **Which hulls are booked to be in two places at once**, on the departures
 * given.
 *
 * `maxConcurrentTrips` above answers a different question — how many vessels a
 * day needs at its busiest — and the board compares that against how many the
 * shop owns. That check cannot see a shop putting two overlapping departures on
 * the *same* boat: two hulls owned, peak of two, no complaint, one vessel in two
 * places. It is also the harder mistake to notice by eye, because it takes three
 * departures before the count says anything at all.
 *
 * Both questions are worth asking, so this is a second function rather than a
 * replacement: a departure with no `boatId` has no vessel to double-book, and
 * the fleet-size count stays its only answer.
 *
 * Boundary-touching intervals do not overlap, the same rule stated above — an
 * 11:00 return and an 11:00 departure is a turnaround, and running one hull
 * twice in a day (two tanks in the morning, a sunset dive) is an ordinary day
 * rather than a mistake.
 */
export function overlappingBoatIds(trips: ReadonlyArray<AssignedTripInterval>): string[] {
  const byBoat = new Map<string, TripTimeInterval[]>();
  for (const trip of trips) {
    if (!trip.boatId) continue;
    const forBoat = byBoat.get(trip.boatId);
    if (forBoat) forBoat.push(trip);
    else byBoat.set(trip.boatId, [trip]);
  }
  const doubled: string[] = [];
  for (const [boatId, forBoat] of byBoat) {
    // One hull's own departures, so "two at once" is exactly `maxConcurrentTrips
    // > 1` — the boundary rule and the sort order come free with it rather than
    // being restated here and drifting.
    if (maxConcurrentTrips(forBoat) > 1) doubled.push(boatId);
  }
  return doubled;
}
