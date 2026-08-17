import type { CourseInquiryExperience } from "./course-inquiry";

/**
 * The request planner's deliberately boring input. It is a planning hint, not
 * a safety or booking decision, so it only reads facts a diver volunteered and
 * never pretends to know which boat a shop has available.
 */
export type RequestAdvisorInput = {
  id: string;
  divers: number | null;
  experienceLevel: CourseInquiryExperience;
  courseId: string | null;
};

export type BoatAdvisorInput = {
  id: string;
  name: string;
  capacity: number;
};

export type RequestAdvice = {
  requestCount: number;
  estimatedDivers: number;
  suggestedCapacity: number;
  suggestedDepartureCount: number;
  experienceMix: Record<CourseInquiryExperience, number>;
  suggestedBoat: { id: string; name: string; capacity: number } | null;
  exceedsKnownBoats: boolean;
  /** Stable strategy id so a later heuristic or provider can be compared. */
  strategy: "transparent-headcount-v1";
};

export type RequestAdvisor = (
  requests: readonly RequestAdvisorInput[],
  boats?: readonly BoatAdvisorInput[],
) => RequestAdvice;

/** The only default we assume about a departure: a common 12-seat starting point. */
export const DEFAULT_DEPARTURE_CAPACITY = 12;
const MAX_DEPARTURE_CAPACITY = 60;

/**
 * A transparent, zero-cost baseline for turning requests into a planning hint.
 *
 * `divers` is a party size, not a guaranteed head count: a blank means one
 * person because the request still represents one conversation. Capacity is
 * rounded to six-seat steps and capped at the product's trip maximum.
 *
 * When the shop has configured boats, the advisor finds the smallest boat
 * that fits the group, or flags if the party size exceeds every known boat.
 * Nothing here books a seat, clears a diver, or chooses a real boat.
 */
export const transparentHeadcountAdvisor: RequestAdvisor = (requests, boats) => {
  const experienceMix: Record<CourseInquiryExperience, number> = {
    never: 0,
    tried: 0,
    certified: 0,
    lapsed: 0,
  };
  const estimatedDivers = requests.reduce((total, request) => {
    experienceMix[request.experienceLevel] += 1;
    return total + Math.max(1, request.divers ?? 1);
  }, 0);

  let suggestedCapacity = Math.min(
    MAX_DEPARTURE_CAPACITY,
    Math.max(DEFAULT_DEPARTURE_CAPACITY, Math.ceil(Math.max(estimatedDivers, 1) / 6) * 6),
  );
  let suggestedDepartureCount = Math.max(
    1,
    Math.ceil(estimatedDivers / DEFAULT_DEPARTURE_CAPACITY),
  );
  let suggestedBoat: { id: string; name: string; capacity: number } | null = null;
  let exceedsKnownBoats = false;

  if (boats && boats.length > 0) {
    const sortedBoats = [...boats].sort((a, b) => a.capacity - b.capacity);
    const fittingBoat = sortedBoats.find((boat) => boat.capacity >= estimatedDivers);
    if (fittingBoat) {
      suggestedBoat = {
        id: fittingBoat.id,
        name: fittingBoat.name,
        capacity: fittingBoat.capacity,
      };
      suggestedCapacity = fittingBoat.capacity;
      suggestedDepartureCount = 1;
    } else {
      exceedsKnownBoats = true;
      const largestBoat = sortedBoats[sortedBoats.length - 1];
      suggestedDepartureCount = Math.max(1, Math.ceil(estimatedDivers / largestBoat.capacity));
    }
  }

  return {
    requestCount: requests.length,
    estimatedDivers,
    suggestedCapacity,
    suggestedDepartureCount,
    experienceMix,
    suggestedBoat,
    exceedsKnownBoats,
    strategy: "transparent-headcount-v1",
  };
};

/** Injection point for a future shop-specific strategy or offline model. */
export function adviseRequests(
  requests: readonly RequestAdvisorInput[],
  boats?: readonly BoatAdvisorInput[],
  advisor: RequestAdvisor = transparentHeadcountAdvisor,
): RequestAdvice {
  return advisor(requests, boats);
}
