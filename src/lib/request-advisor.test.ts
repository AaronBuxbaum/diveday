import { describe, expect, it } from "vitest";
import {
  adviseRequests,
  DEFAULT_DEPARTURE_CAPACITY,
  departureShapeFor,
  transparentHeadcountAdvisor,
} from "./request-advisor";

describe("transparent request advisor", () => {
  it("uses one diver for a request with no party size", () => {
    expect(
      transparentHeadcountAdvisor([
        { id: "one", divers: null, experienceLevel: "certified", courseId: null },
      ]),
    ).toMatchObject({
      requestCount: 1,
      estimatedDivers: 1,
      suggestedCapacity: DEFAULT_DEPARTURE_CAPACITY,
      suggestedDepartureCount: 1,
      experienceMix: { certified: 1 },
    });
  });

  it("rounds a large group up without exceeding the trip maximum", () => {
    const advice = transparentHeadcountAdvisor([
      { id: "one", divers: 13, experienceLevel: "tried", courseId: null },
      { id: "two", divers: 8, experienceLevel: "never", courseId: "course" },
    ]);
    expect(advice.estimatedDivers).toBe(21);
    expect(advice.suggestedCapacity).toBe(24);
    expect(advice.suggestedDepartureCount).toBe(2);
    expect(advice.experienceMix).toEqual({ never: 1, tried: 1, certified: 0, lapsed: 0 });
  });

  it("suggests the smallest boat that fits the party", () => {
    const boats = [
      { id: "big", name: "Large Catamaran", capacity: 24 },
      { id: "small", name: "Small Rib", capacity: 8 },
      { id: "medium", name: "Monohull", capacity: 14 },
    ];
    const advice = transparentHeadcountAdvisor(
      [
        { id: "one", divers: 6, experienceLevel: "certified", courseId: null },
        { id: "two", divers: 4, experienceLevel: "tried", courseId: null },
      ],
      { kind: "boats", boats },
    );
    expect(advice.estimatedDivers).toBe(10);
    expect(advice.suggestedBoat?.name).toBe("Monohull");
    expect(advice.suggestedCapacity).toBe(14);
    expect(advice.exceedsKnownBoats).toBe(false);
    expect(advice.suggestedDepartureCount).toBe(1);
  });

  it("flags when party size exceeds every known boat", () => {
    const boats = [
      { id: "small", name: "Small Rib", capacity: 8 },
      { id: "medium", name: "Monohull", capacity: 12 },
    ];
    const advice = transparentHeadcountAdvisor(
      [{ id: "one", divers: 15, experienceLevel: "certified", courseId: null }],
      { kind: "boats", boats },
    );
    expect(advice.estimatedDivers).toBe(15);
    expect(advice.suggestedBoat).toBeNull();
    expect(advice.exceedsKnownBoats).toBe(true);
    expect(advice.suggestedDepartureCount).toBe(2);
  });

  it("sizes a day against the shop's own group size when there is no boat to ask", () => {
    // A shore-and-pool shop has no hull, so the divisor is a preference rather
    // than a fact. Eleven divers at six a guide is two departures.
    const advice = transparentHeadcountAdvisor(
      [
        { id: "one", divers: 6, experienceLevel: "certified", courseId: null },
        { id: "two", divers: 5, experienceLevel: "tried", courseId: null },
      ],
      { kind: "group", groupSize: 6 },
    );
    expect(advice.estimatedDivers).toBe(11);
    expect(advice.suggestedCapacity).toBe(6);
    expect(advice.suggestedDepartureCount).toBe(2);
    // The two facts that would be nonsense on a beach.
    expect(advice.suggestedBoat).toBeNull();
    expect(advice.exceedsKnownBoats).toBe(false);
  });

  it("falls back to the default when a shore shop has not stated a group size", () => {
    const advice = transparentHeadcountAdvisor(
      [{ id: "one", divers: 4, experienceLevel: "certified", courseId: null }],
      { kind: "group", groupSize: null },
    );
    expect(advice.suggestedCapacity).toBe(DEFAULT_DEPARTURE_CAPACITY);
    expect(advice.suggestedDepartureCount).toBe(1);
    expect(advice.suggestedBoat).toBeNull();
  });

  it("reads a shop row the same way for both callers", () => {
    // The Requests page and the schedule board must not disagree about what a
    // shop with boat diving off is planning against, which is the whole reason
    // `departureShapeFor` exists rather than two inline ternaries.
    const boats = [{ id: "a", name: "Rib", capacity: 8 }];
    expect(departureShapeFor({ hasBoatDiving: true, shoreGroupSize: 4 }, boats)).toEqual({
      kind: "boats",
      boats,
    });
    // Boats off: the hull rows survive in the database but are not planned with.
    expect(departureShapeFor({ hasBoatDiving: false, shoreGroupSize: 4 }, boats)).toEqual({
      kind: "group",
      groupSize: 4,
    });
  });

  it("can be replaced by an injected strategy", () => {
    const advice = adviseRequests([], undefined, () => ({
      requestCount: 0,
      estimatedDivers: 0,
      suggestedCapacity: 6,
      suggestedDepartureCount: 1,
      experienceMix: { never: 0, tried: 0, certified: 0, lapsed: 0 },
      suggestedBoat: null,
      exceedsKnownBoats: false,
      strategy: "transparent-headcount-v1",
    }));
    expect(advice.suggestedCapacity).toBe(6);
  });
});
