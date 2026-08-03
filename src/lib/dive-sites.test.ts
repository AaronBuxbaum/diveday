import { describe, expect, it } from "vitest";
import { parseDiveSiteForm, splitMediaUrls } from "./dive-sites";

/** A minimal valid submission; every test below varies one field of it. */
function formEntries(overrides: Record<string, string> = {}): Record<string, unknown> {
  return {
    name: "Turtle Garden",
    description: "",
    locationName: "",
    forecastLatitude: "",
    forecastLongitude: "",
    satelliteImageUrl: "",
    routeImageUrl: "",
    imageUrls: "",
    marineLife: "",
    marineLifeDescription: "",
    difficulty: "",
    depthRange: "",
    maxDepth: "",
    currentNote: "",
    divePlan: "",
    landmarks: "",
    minimumCertificationLevel: "",
    ...overrides,
  };
}

describe("splitMediaUrls", () => {
  it("keeps unique, valid HTTP image links in their entered order", () => {
    expect(
      splitMediaUrls(
        " https://images.example/reef.jpg\nhttps://images.example/turtle.jpg\nhttps://images.example/reef.jpg ",
      ),
    ).toEqual(["https://images.example/reef.jpg", "https://images.example/turtle.jpg"]);
  });

  it("rejects non-web links", () => {
    expect(() => splitMediaUrls("ftp://images.example/reef.jpg")).toThrow("HTTP(S)");
  });

  it("limits a briefing to six images", () => {
    expect(() =>
      splitMediaUrls(Array.from({ length: 7 }, (_, i) => `https://images.example/${i}`).join("\n")),
    ).toThrow("six");
  });
});

describe("parseDiveSiteForm", () => {
  it("accepts a briefing with no coordinates at all", () => {
    const result = parseDiveSiteForm(formEntries(), "meters");
    expect(result).toMatchObject({ ok: true, maxDepthMeters: null });
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
