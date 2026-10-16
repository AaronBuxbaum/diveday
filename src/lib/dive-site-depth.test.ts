import { describe, expect, it } from "vitest";
import { siteDepthInUnit } from "./dive-site-depth";

describe("siteDepthInUnit", () => {
  it("reads a range in metres", () => {
    expect(siteDepthInUnit({ depthMinMeters: 15, maxDepthMeters: 28 }, "meters")).toEqual({
      min: 15,
      max: 28,
    });
  });

  it("reads the same range in feet, rounded to whole feet", () => {
    expect(siteDepthInUnit({ depthMinMeters: 15, maxDepthMeters: 28 }, "feet")).toEqual({
      min: 49,
      max: 92,
    });
  });

  it("reads a range typed in feet back as typed", () => {
    // 20 ft and 60 ft are stored as 6.096 m and 18.288 m.
    expect(siteDepthInUnit({ depthMinMeters: 6.096, maxDepthMeters: 18.288 }, "feet")).toEqual({
      min: 20,
      max: 60,
    });
  });

  it("gives only the deepest figure when no shallow end is recorded", () => {
    expect(siteDepthInUnit({ depthMinMeters: null, maxDepthMeters: 18 }, "meters")).toEqual({
      min: null,
      max: 18,
    });
  });

  it("gives one figure when the two ends round to the same number", () => {
    expect(siteDepthInUnit({ depthMinMeters: 17.6, maxDepthMeters: 18 }, "meters")).toEqual({
      min: null,
      max: 18,
    });
  });

  it("says nothing without a deepest point, even with a shallow end", () => {
    expect(siteDepthInUnit({ depthMinMeters: 6, maxDepthMeters: null }, "meters")).toBeNull();
    expect(siteDepthInUnit({}, "feet")).toBeNull();
  });
});
