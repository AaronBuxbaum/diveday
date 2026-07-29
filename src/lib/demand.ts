export type DemandRecommendation = {
  waitlistThreshold: number;
  unmetSeats: number;
  message: string;
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
  return {
    waitlistThreshold,
    unmetSeats: input.waitlisted,
    message: `${input.waitlisted} divers are still waiting after this trip filled. Consider adding another boat or a second departure.`,
  };
}
