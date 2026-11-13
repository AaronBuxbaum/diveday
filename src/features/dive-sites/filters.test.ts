import { describe, expect, it } from "vitest";
import { parseMapArea, parseSiteFilters, siteListHref } from "./filters";

describe("dive-site filters in the URL", () => {
  it("reads known words and drops the rest", () => {
    expect(parseSiteFilters({ difficulty: "advanced", need: "wreck" })).toMatchObject({
      difficulty: "advanced",
      need: "wreck",
    });
    expect(parseSiteFilters({ difficulty: "hard", need: "x", area: "nope" })).toEqual({
      difficulty: undefined,
      need: undefined,
      area: undefined,
    });
  });

  it("refuses an upside-down or non-numeric map area and clamps the globe", () => {
    expect(parseMapArea("1,2,0,3")).toBeUndefined();
    expect(parseMapArea("a,b,c,d")).toBeUndefined();
    expect(parseMapArea("-95,-200,95,200")).toEqual({
      south: -90,
      west: -180,
      north: 90,
      east: 180,
    });
  });

  it("builds a URL with only the choices made", () => {
    expect(siteListHref("/s", {})).toBe("/s");
    expect(siteListHref("/s", { q: "reef", difficulty: "beginner", page: 2 })).toBe(
      "/s?q=reef&difficulty=beginner&page=2",
    );
  });
});
