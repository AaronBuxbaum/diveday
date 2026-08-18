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
