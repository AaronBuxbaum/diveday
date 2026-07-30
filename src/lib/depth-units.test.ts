import { describe, expect, it } from "vitest";
import {
  depthInUnit,
  depthToMeters,
  feetToMeters,
  maxEnteredDepth,
  metersToFeet,
} from "./depth-units";

describe("metersToFeet / feetToMeters", () => {
  it("uses the exact international foot", () => {
    expect(feetToMeters(60)).toBeCloseTo(18.288, 10);
    expect(metersToFeet(18.288)).toBeCloseTo(60, 10);
  });

  it("round-trips without drift", () => {
    for (const feet of [10, 33, 60, 100, 130]) {
      expect(metersToFeet(feetToMeters(feet))).toBeCloseTo(feet, 10);
    }
  });
});

describe("depthInUnit", () => {
  it("passes metres straight through, rounded to a whole number", () => {
    expect(depthInUnit(18, "meters")).toBe(18);
    expect(depthInUnit(18.288, "meters")).toBe(18);
  });

  it("converts to whole feet", () => {
    expect(depthInUnit(18.288, "feet")).toBe(60);
    expect(depthInUnit(30, "feet")).toBe(98);
  });

  it("reads back exactly what a feet-first shop typed", () => {
    // The reason the column is floating-point: stored as whole metres, 60 ft
    // would come back as 59 and the shop would think DiveDay lost their number.
    for (const feet of [12, 40, 60, 70, 100, 130]) {
      expect(depthInUnit(depthToMeters(feet, "feet"), "feet")).toBe(feet);
    }
  });
});

describe("depthToMeters", () => {
  it("leaves a metres entry alone", () => {
    expect(depthToMeters(18, "meters")).toBe(18);
  });

  it("converts a feet entry to stored metres", () => {
    expect(depthToMeters(60, "feet")).toBeCloseTo(18.288, 10);
  });
});

describe("maxEnteredDepth", () => {
  it("states the typo guard in the shop's own unit", () => {
    expect(maxEnteredDepth("meters")).toBe(300);
    expect(maxEnteredDepth("feet")).toBe(984);
  });
});
