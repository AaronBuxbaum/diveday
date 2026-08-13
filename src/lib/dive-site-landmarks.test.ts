import { describe, expect, it } from "vitest";
import { MAX_SITE_LANDMARKS, parseDiveSiteLandmarks } from "./dive-site-landmarks";

describe("dive-site landmarks", () => {
  it("keeps the shop's own words about each landmark", () => {
    const landmarks = parseDiveSiteLandmarks([
      {
        name: "Molasses Reef Light",
        kind: "navigationMark",
        note: "The easiest above-water reference on the whole reef.",
      },
    ]);

    expect(landmarks).toEqual([
      {
        name: "Molasses Reef Light",
        kind: "navigationMark",
        note: "The easiest above-water reference on the whole reef.",
      },
    ]);
  });

  it("reads a bare name as a landmark with nothing said about it", () => {
    // What every row held before landmarks carried a note, and what the CSV
    // import still accepts.
    expect(parseDiveSiteLandmarks(["Cleaning station"])).toEqual([
      { name: "Cleaning station", kind: "pointOfInterest", note: "" },
    ]);
  });

  it("parses the JSON string the site form posts", () => {
    const landmarks = parseDiveSiteLandmarks('[{"name":"Bow section","kind":"wreckFeature"}]');
    expect(landmarks).toEqual([{ name: "Bow section", kind: "wreckFeature", note: "" }]);
  });

  it("falls back to a point of interest rather than trusting an unknown kind", () => {
    const [landmark] = parseDiveSiteLandmarks([{ name: "Swim-through", kind: "haunted" }]);
    expect(landmark?.kind).toBe("pointOfInterest");
  });

  it("drops entries with no name, and anything past the cap", () => {
    expect(parseDiveSiteLandmarks([{ note: "orphan" }, "  ", 7, null])).toEqual([]);
    const many = Array.from({ length: MAX_SITE_LANDMARKS + 5 }, (_, index) => `Mark ${index}`);
    expect(parseDiveSiteLandmarks(many)).toHaveLength(MAX_SITE_LANDMARKS);
  });

  it("never throws on unusable input", () => {
    expect(parseDiveSiteLandmarks("not json")).toEqual([]);
    expect(parseDiveSiteLandmarks(undefined)).toEqual([]);
    expect(parseDiveSiteLandmarks({ name: "not a list" })).toEqual([]);
  });
});
