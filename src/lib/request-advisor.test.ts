import { describe, expect, it } from "vitest";
import {
  adviseRequests,
  DEFAULT_DEPARTURE_CAPACITY,
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
      boats,
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
      boats,
    );
    expect(advice.estimatedDivers).toBe(15);
    expect(advice.suggestedBoat).toBeNull();
    expect(advice.exceedsKnownBoats).toBe(true);
    expect(advice.suggestedDepartureCount).toBe(2);
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
