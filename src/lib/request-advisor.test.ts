import { describe, expect, it } from "vitest";
import {
  adviseRequests,
  DEFAULT_DEPARTURE_CAPACITY,
  type DepartureShape,
  departureShapeFor,
  transparentHeadcountAdvisor,
} from "./request-advisor";

/** A boat shop at the default target, unless a test says otherwise. */
const withHulls = (boats: DepartureShape["hulls"], diversPerDivemaster = 6): DepartureShape => ({
  hulls: boats,
  diversPerDivemaster,
});

const noHulls = (diversPerDivemaster = 6): DepartureShape => ({
  hulls: null,
  diversPerDivemaster,
});

describe("transparent request advisor", () => {
  it("uses one diver for a request with no party size", () => {
    expect(
      transparentHeadcountAdvisor(
        [{ id: "one", divers: null, experienceLevel: "certified", courseId: null }],
        withHulls([]),
      ),
    ).toMatchObject({
      requestCount: 1,
      estimatedDivers: 1,
      suggestedCapacity: DEFAULT_DEPARTURE_CAPACITY,
      suggestedDepartureCount: 1,
      suggestedDivemasters: 1,
      experienceMix: { certified: 1 },
    });
  });

  it("rounds a large group up without exceeding the trip maximum", () => {
    const advice = transparentHeadcountAdvisor(
      [
        { id: "one", divers: 13, experienceLevel: "tried", courseId: null },
        { id: "two", divers: 8, experienceLevel: "never", courseId: "course" },
      ],
      withHulls([]),
    );
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
      withHulls(boats),
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
      withHulls(boats),
    );
    expect(advice.estimatedDivers).toBe(15);
    expect(advice.suggestedBoat).toBeNull();
    expect(advice.exceedsKnownBoats).toBe(true);
    expect(advice.suggestedDepartureCount).toBe(2);
  });

  it("sizes a boatless day by the people who asked, not by a phantom seat count", () => {
    // The coarse "divers per departure" this replaced split eleven divers into
    // two beach "departures" — an object a shore shop does not have. One day,
    // eleven people, and the crew suggestion carries the shop's target instead.
    const advice = transparentHeadcountAdvisor(
      [
        { id: "one", divers: 6, experienceLevel: "certified", courseId: null },
        { id: "two", divers: 5, experienceLevel: "tried", courseId: null },
      ],
      noHulls(6),
    );
    expect(advice.estimatedDivers).toBe(11);
    expect(advice.suggestedCapacity).toBe(11);
    expect(advice.suggestedDepartureCount).toBe(1);
    expect(advice.suggestedDivemasters).toBe(2);
    // The two facts that would be nonsense on a beach.
    expect(advice.suggestedBoat).toBeNull();
    expect(advice.exceedsKnownBoats).toBe(false);
  });

  it("crews for the divers who asked, not for a suggested hull's empty seats", () => {
    // A party of four on the smallest free 12-seat boat wants one divemaster,
    // not the two a 12-seat capacity would imply at a 3:1 target.
    const advice = transparentHeadcountAdvisor(
      [{ id: "one", divers: 4, experienceLevel: "certified", courseId: null }],
      withHulls([{ id: "a", name: "Rib", capacity: 12 }], 3),
    );
    expect(advice.suggestedCapacity).toBe(12);
    expect(advice.suggestedDivemasters).toBe(2);
  });

  it("asks for nobody when nobody asked", () => {
    expect(transparentHeadcountAdvisor([], noHulls()).suggestedDivemasters).toBe(0);
  });

  it("reads a shop row the same way for both callers", () => {
    // The Requests page and the schedule board must not disagree about what a
    // shop with boat diving off is planning against, which is the whole reason
    // `departureShapeFor` exists rather than two inline ternaries.
    const boats = [{ id: "a", name: "Rib", capacity: 8 }];
    expect(departureShapeFor({ hasBoatDiving: true, diversPerDivemaster: 4 }, boats)).toEqual({
      hulls: boats,
      diversPerDivemaster: 4,
    });
    // Boats off: the hull rows survive in the database but are not planned
    // with, and the target is the same question either way.
    expect(departureShapeFor({ hasBoatDiving: false, diversPerDivemaster: 4 }, boats)).toEqual({
      hulls: null,
      diversPerDivemaster: 4,
    });
  });

  it("can be replaced by an injected strategy", () => {
    const advice = adviseRequests([], noHulls(), () => ({
      requestCount: 0,
      estimatedDivers: 0,
      suggestedCapacity: 6,
      suggestedDepartureCount: 1,
      suggestedDivemasters: 1,
      experienceMix: { never: 0, tried: 0, certified: 0, lapsed: 0 },
      suggestedBoat: null,
      exceedsKnownBoats: false,
      strategy: "transparent-headcount-v1",
    }));
    expect(advice.suggestedCapacity).toBe(6);
  });
});
