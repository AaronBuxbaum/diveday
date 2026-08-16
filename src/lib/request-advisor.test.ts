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

  it("can be replaced by an injected strategy", () => {
    const advice = adviseRequests([], () => ({
      requestCount: 0,
      estimatedDivers: 0,
      suggestedCapacity: 6,
      suggestedDepartureCount: 1,
      experienceMix: { never: 0, tried: 0, certified: 0, lapsed: 0 },
      strategy: "transparent-headcount-v1",
    }));
    expect(advice.suggestedCapacity).toBe(6);
  });
});
