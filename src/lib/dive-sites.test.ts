import { describe, expect, it } from "vitest";
import { parseDiveSiteForm } from "./dive-sites";

/** A minimal valid submission; every test below varies one field of it. */
function formEntries(overrides: Record<string, string> = {}): Record<string, unknown> {
  return {
    name: "Turtle Garden",
    description: "",
    locationName: "",
    forecastLatitude: "",
    forecastLongitude: "",
    marineLife: "",
    marineLifeDescription: "",
    difficulty: "",
    depthRange: "",
    maxDepth: "",
    expectedBottomTime: "",
    currentNote: "",
    divePlan: "",
    landmarks: "",
    minimumCertificationLevel: "",
    ...overrides,
  };
}

describe("parseDiveSiteForm", () => {
  it("accepts a briefing with no coordinates at all", () => {
    const result = parseDiveSiteForm(formEntries(), "meters");
    expect(result).toMatchObject({ ok: true, maxDepthMeters: null });
  });

  // A site that names no time in the water is the ordinary case: the shop's
  // own figure stands, and null is what says so.
  it("reads a blank time in the water as the shop's own figure", () => {
    const result = parseDiveSiteForm(formEntries(), "meters");
    expect(result).toMatchObject({ ok: true, expectedBottomTimeMinutes: null });
  });

  it("keeps a site's own time in the water in minutes, whatever unit the shop reads depth in", () => {
    const result = parseDiveSiteForm(formEntries({ expectedBottomTime: "30" }), "feet");
    expect(result).toMatchObject({ ok: true, expectedBottomTimeMinutes: 30 });
  });

  // The same bounds the Settings form applies to the shop's own figure — a
  // site must not be able to name a day Settings would have refused.
  it("refuses a time in the water outside the shop rhythm's own bounds", () => {
    expect(parseDiveSiteForm(formEntries({ expectedBottomTime: "0" }), "meters").ok).toBe(false);
    expect(parseDiveSiteForm(formEntries({ expectedBottomTime: "600" }), "meters").ok).toBe(false);
    expect(parseDiveSiteForm(formEntries({ expectedBottomTime: "45.5" }), "meters").ok).toBe(false);
  });

  it("accepts a complete coordinate pair", () => {
    const result = parseDiveSiteForm(
      formEntries({ forecastLatitude: "25.123", forecastLongitude: "-80.321" }),
      "meters",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.forecastLatitude).toBe(25.123);
      expect(result.fields.forecastLongitude).toBe(-80.321);
    }
  });

  // The regression this whole slice exists for: a half-entered forecast point
  // was refused as a generic "invalid", which the create form rendered as
  // "check the required name and links" — naming neither coordinate, while the
  // name was fine. Each half gets the same, specific code.
  it.each([
    ["latitude only", { forecastLatitude: "25.123" }],
    ["longitude only", { forecastLongitude: "-80.321" }],
  ])("refuses %s with the coordinate-pairing code, not a generic one", (_label, overrides) => {
    expect(parseDiveSiteForm(formEntries(overrides), "meters")).toEqual({
      ok: false,
      error: "coordinatesIncomplete",
    });
  });

  it("names the depth ceiling rather than blaming the form at large", () => {
    // 600 m is past `MAX_ENTERED_DEPTH_METERS` but inside the schema's own
    // loose 1,000 outer guard, so only the unit-aware check can catch it.
    expect(parseDiveSiteForm(formEntries({ maxDepth: "600" }), "meters")).toEqual({
      ok: false,
      error: "depthTooDeep",
    });
  });

  it("reads the depth in the shop's own unit", () => {
    const result = parseDiveSiteForm(formEntries({ maxDepth: "60" }), "feet");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.maxDepthMeters).toBeCloseTo(18.288, 3);
  });

  it("still refuses a nameless site as invalid", () => {
    expect(parseDiveSiteForm(formEntries({ name: "  " }), "meters")).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
