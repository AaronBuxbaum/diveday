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

export type RequestAdvice = {
  requestCount: number;
  estimatedDivers: number;
  suggestedCapacity: number;
  suggestedDepartureCount: number;
  experienceMix: Record<CourseInquiryExperience, number>;
  /** Stable strategy id so a later heuristic or provider can be compared. */
  strategy: "transparent-headcount-v1";
};

export type RequestAdvisor = (requests: readonly RequestAdvisorInput[]) => RequestAdvice;

/** The only default we assume about a departure: a common 12-seat starting point. */
export const DEFAULT_DEPARTURE_CAPACITY = 12;
const MAX_DEPARTURE_CAPACITY = 60;

/**
 * A transparent, zero-cost baseline for turning requests into a planning hint.
 *
 * `divers` is a party size, not a guaranteed head count: a blank means one
 * person because the request still represents one conversation. Capacity is
 * rounded to six-seat steps and capped at the product's trip maximum. Nothing
 * here books a seat, clears a diver, or chooses a real boat.
 */
export const transparentHeadcountAdvisor: RequestAdvisor = (requests) => {
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
  const suggestedCapacity = Math.min(
    MAX_DEPARTURE_CAPACITY,
    Math.max(DEFAULT_DEPARTURE_CAPACITY, Math.ceil(Math.max(estimatedDivers, 1) / 6) * 6),
  );

  return {
    requestCount: requests.length,
    estimatedDivers,
    suggestedCapacity,
    suggestedDepartureCount: Math.max(1, Math.ceil(estimatedDivers / DEFAULT_DEPARTURE_CAPACITY)),
    experienceMix,
    strategy: "transparent-headcount-v1",
  };
};

/** Injection point for a future shop-specific strategy or offline model. */
export function adviseRequests(
  requests: readonly RequestAdvisorInput[],
  advisor: RequestAdvisor = transparentHeadcountAdvisor,
): RequestAdvice {
  return advisor(requests);
}
