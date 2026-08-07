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

/**
 * A code, not a sentence (ADR 20260731-domain-layer-copy-leaks) — the domain
 * layer never picks the words. Callers render it through the `fallback.full`
 * / `fallback.spotsLeft` bundle keys (the diver and staff bundles both carry
 * them), which is what actually pluralizes and translates "3 spots left".
 */
export type CapacityLabel = { kind: "full" } | { kind: "left"; remaining: number };

export function capacityLabel(trip: TripCapacity): CapacityLabel {
  const remaining = spotsRemaining(trip);
  return remaining === 0 ? { kind: "full" } : { kind: "left", remaining };
}
