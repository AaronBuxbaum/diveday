import { describe, expect, it } from "vitest";
import { getSeedDiveSiteMap, googleMapsUrl, googleSatelliteEmbedUrl } from "./dive-site-map";

describe("seed dive-site maps", () => {
  it("gives every seeded public briefing a satellite map with a route", () => {
    for (const name of ["Molasses Reef", "Spiegel Grove", "Christ of the Abyss"]) {
      const map = getSeedDiveSiteMap(name);
      expect(map).not.toBeNull();
      expect(map?.stops.length).toBeGreaterThan(0);
    }
  });

  it("builds satellite embeds and a direct map link from a location query", () => {
    expect(googleSatelliteEmbedUrl("Molasses Reef, Key Largo")).toContain("t=k");
    expect(googleSatelliteEmbedUrl("Molasses Reef, Key Largo")).toContain("output=embed");
    expect(googleMapsUrl("Molasses Reef, Key Largo")).toContain("api=1");
  });
});
