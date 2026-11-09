import { describe, expect, it } from "vitest";
import { compactCatalogPins } from "./catalog-map-pins";

describe("compact catalog map wire payload", () => {
  it("retains every global coordinate/id/name and excludes all briefing/presentation data", () => {
    const rows = [
      {
        templateId: "a",
        slug: "first-reef",
        name: "Reef",
        latitude: 1,
        longitude: 2,
        description: "Long briefing",
        details: ["18 m"],
        hrefLabel: "Open",
        tone: "primary",
      },
      {
        templateId: "b",
        slug: "far-reef",
        name: "Far reef",
        latitude: -50,
        longitude: 170,
        description: "Other briefing",
      },
    ];
    expect(compactCatalogPins(rows)).toEqual([
      { id: "a", slug: "first-reef", name: "Reef", latitude: 1, longitude: 2 },
      { id: "b", slug: "far-reef", name: "Far reef", latitude: -50, longitude: 170 },
    ]);
    expect(JSON.stringify(compactCatalogPins(rows))).not.toContain("briefing");
  });
});
