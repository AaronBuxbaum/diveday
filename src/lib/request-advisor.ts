import type { CourseInquiryExperience } from "./course-inquiry";
import { divemastersNeeded } from "./divemaster-ratio";

/**
 * The request planner's deliberately boring input. It is a planning hint, not
 * a safety or booking decision, so it only reads facts a diver volunteered and
 * never pretends to know which boat a shop has available.
 */
export type RequestAdvisorInput = {
  id: string;
  divers: number | null;
  experienceLevel: CourseInquiryExperience | null;
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
  /** Divemasters the suggested departure wants at the shop's target ratio. */
  suggestedDivemasters: number;
  experienceMix: Record<CourseInquiryExperience, number>;
  suggestedBoat: { id: string; name: string; capacity: number } | null;
  exceedsKnownBoats: boolean;
  /** Stable strategy id so a later heuristic or provider can be compared. */
  strategy: "transparent-headcount-v1";
};

/**
 * What the shop can put a day's requests on.
 *
 * `hulls` is a *fact* a boat shop has and a shore-and-pool shop does not — a
 * 12-seat boat holds twelve people — so it is null rather than empty for a
 * shop that runs no boats, and the planner never names a hull it hasn't got.
 *
 * `diversPerDivemaster` is the shop's own target (`src/lib/divemaster-ratio.ts`)
 * and every shop has one, because it is the question that survives having no
 * boat: how many people one divemaster takes into the water. It is what the
 * planner sizes a beach day by, and what it recommends a crew from either way.
 */
export type DepartureShape = {
  hulls: readonly BoatAdvisorInput[] | null;
  diversPerDivemaster: number;
};

/** The only default we assume about a departure: a common 12-seat starting point. */
export const DEFAULT_DEPARTURE_CAPACITY = 12;
export const MAX_DEPARTURE_CAPACITY = 60;

export type RequestAdvisor = (
  requests: readonly RequestAdvisorInput[],
  shape: DepartureShape,
) => RequestAdvice;

/**
 * A transparent, zero-cost baseline for turning requests into a planning hint.
 *
 * `divers` is a party size, not a guaranteed head count: a blank means one
 * person because the request still represents one conversation. Capacity is
 * rounded to six-seat steps and capped at the product's trip maximum.
 *
 * When the shop has configured boats, the advisor finds the smallest boat that
 * fits the group, or flags if the party size exceeds every known boat. When the
 * shop runs no boats there is no seat count to fit anyone into, so the day is
 * one departure the size of the people who asked for it. Either way the crew
 * suggestion comes off the shop's target ratio. Nothing here books a seat,
 * clears a diver, chooses a real boat, or rosters anybody.
 */
export const transparentHeadcountAdvisor: RequestAdvisor = (requests, shape) => {
  const experienceMix: Record<CourseInquiryExperience, number> = {
    never: 0,
    tried: 0,
    certified: 0,
    lapsed: 0,
  };
  const estimatedDivers = requests.reduce((total, request) => {
    if (request.experienceLevel) experienceMix[request.experienceLevel] += 1;
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

  if (shape.hulls === null) {
    // No hull to ask, so nothing fixes the size of the day but the people who
    // asked for it — the shop brings the divemasters its target implies rather
    // than splitting a beach into arbitrary "departures". `exceedsKnownBoats`
    // stays false and `suggestedBoat` stays null: there is no boat to exceed,
    // and a warning about one would be nonsense on a beach.
    suggestedCapacity = Math.min(MAX_DEPARTURE_CAPACITY, Math.max(1, estimatedDivers));
    suggestedDepartureCount = Math.max(1, Math.ceil(estimatedDivers / MAX_DEPARTURE_CAPACITY));
  } else if (shape.hulls.length > 0) {
    const sortedBoats = [...shape.hulls].sort((a, b) => a.capacity - b.capacity);
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
    // Crewed for the people who actually asked, never for the empty seats a
    // suggested hull happens to carry: recommending three divemasters for a
    // party of four because the smallest free boat seats twelve is advice no
    // shop would follow.
    suggestedDivemasters: divemastersNeeded(estimatedDivers, shape.diversPerDivemaster),
    experienceMix,
    suggestedBoat,
    exceedsKnownBoats,
    strategy: "transparent-headcount-v1",
  };
};

/** Injection point for a future shop-specific strategy or offline model. */
export function adviseRequests(
  requests: readonly RequestAdvisorInput[],
  shape: DepartureShape,
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
  shop: { hasBoatDiving: boolean; diversPerDivemaster: number },
  boats: readonly BoatAdvisorInput[],
): DepartureShape {
  return {
    hulls: shop.hasBoatDiving ? boats : null,
    diversPerDivemaster: shop.diversPerDivemaster,
  };
}
