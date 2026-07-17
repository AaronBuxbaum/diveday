/**
 * Capacity math for trips. Kept framework-free so booking flows, manifests,
 * and the schedule UI all agree on what "full" means.
 */

export type TripCapacity = {
  capacity: number;
  /** Active (non-cancelled) bookings holding a spot. */
  booked: number;
};

export function spotsRemaining({ capacity, booked }: TripCapacity): number {
  return Math.max(0, capacity - booked);
}

export function isFull(trip: TripCapacity): boolean {
  return spotsRemaining(trip) === 0;
}

/** "3 spots left", "1 spot left", or "Full" — booking-page voice. */
export function capacityLabel(trip: TripCapacity): string {
  const remaining = spotsRemaining(trip);
  if (remaining === 0) return "Full";
  return remaining === 1 ? "1 spot left" : `${remaining} spots left`;
}
