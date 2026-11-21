export type DemandRecommendation = {
  waitlistThreshold: number;
  unmetSeats: number;
};

/**
 * A deliberately conservative signal: the current departure must be full and
 * the wait list must hold at least two people or 25% of another boat. One
 * eager diver is follow-up work; a meaningful cluster is capacity planning.
 */
export function demandRecommendation(input: {
  capacity: number;
  booked: number;
  waitlisted: number;
}): DemandRecommendation | null {
  const waitlistThreshold = Math.max(2, Math.ceil(input.capacity * 0.25));
  if (input.booked < input.capacity || input.waitlisted < waitlistThreshold) return null;
  // Numbers, and no sentence: the Guests tab words this from the staff bundle
  // (`trips.guests.demandBody`). It read as English to a Spanish-speaking shop
  // for as long as it lived here, and the guard that forbids exactly this could
  // not see it because the count is interpolated (issue #1655).
  return { waitlistThreshold, unmetSeats: input.waitlisted };
}
