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

/**
 * What the shop can put a day's requests on.
 *
 * A boat shop answers with its hulls, and the answer is a *fact* — a 12-seat
 * boat holds twelve people. A shore-and-pool shop has no hull to ask, so it
 * answers with a *preference*: how many divers one guide takes into the water
 * at a time. The two are not interchangeable, which is why turning boat diving
 * off does not simply hide the boat line and keep sizing days against a
 * phantom 12-seat default.
 */
export type DepartureShape =
  | { kind: "boats"; boats: readonly BoatAdvisorInput[] }
  | { kind: "group"; groupSize: number | null };

export type RequestAdvisor = (
  requests: readonly RequestAdvisorInput[],
  shape?: DepartureShape,
) => RequestAdvice;

/** The only default we assume about a departure: a common 12-seat starting point. */
export const DEFAULT_DEPARTURE_CAPACITY = 12;
export const MAX_DEPARTURE_CAPACITY = 60;

/**
 * A transparent, zero-cost baseline for turning requests into a planning hint.
 *
 * `divers` is a party size, not a guaranteed head count: a blank means one
 * person because the request still represents one conversation. Capacity is
 * rounded to six-seat steps and capped at the product's trip maximum.
 *
 * When the shop has configured boats, the advisor finds the smallest boat
 * that fits the group, or flags if the party size exceeds every known boat.
 * When the shop runs no boats it sizes the day against its own stated group
 * size instead, and never names a hull. Nothing here books a seat, clears a
 * diver, or chooses a real boat.
 */
export const transparentHeadcountAdvisor: RequestAdvisor = (requests, shape) => {
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

  if (shape?.kind === "group") {
    // No hull to ask, so the shop's own guide-to-diver number is the divisor.
    // `exceedsKnownBoats` stays false and `suggestedBoat` stays null: there is
    // no boat to exceed, and a warning about one would be nonsense on a beach.
    const groupSize = shape.groupSize ?? DEFAULT_DEPARTURE_CAPACITY;
    suggestedCapacity = Math.min(MAX_DEPARTURE_CAPACITY, Math.max(1, groupSize));
    suggestedDepartureCount = Math.max(1, Math.ceil(estimatedDivers / suggestedCapacity));
  } else if (shape?.kind === "boats" && shape.boats.length > 0) {
    const sortedBoats = [...shape.boats].sort((a, b) => a.capacity - b.capacity);
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
  shape?: DepartureShape,
  advisor: RequestAdvisor = transparentHeadcountAdvisor,
): RequestAdvice {
  return advisor(requests, shape);
}

/**
 * The one place that turns a shop row into a `DepartureShape`, so the two
 * callers (the Requests page and the schedule board) cannot disagree about what
 * a shop with boat diving off is planning against.
 */
export function departureShapeFor(
  shop: { hasBoatDiving: boolean; shoreGroupSize: number | null },
  boats: readonly BoatAdvisorInput[],
): DepartureShape {
  return shop.hasBoatDiving
    ? { kind: "boats", boats }
    : { kind: "group", groupSize: shop.shoreGroupSize };
}
