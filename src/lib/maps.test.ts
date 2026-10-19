import { describe, expect, it } from "vitest";
import {
  googleMapEmbedUrl,
  googleMapsUrl,
  googleTerrainEmbedUrl,
  openMapsUrl,
  osmCoordsEmbedUrl,
  osmMapEmbedUrl,
} from "./maps";

describe("osmCoordsEmbedUrl", () => {
  it("centers on the coordinates with an OSM bounding box and no marker by default", () => {
    const url = osmCoordsEmbedUrl("25.0106,-80.3756", 16);
    expect(url).toContain("https://www.openstreetmap.org/export/embed.html");
    expect(url).toContain("bbox=");
    expect(url).not.toContain("&marker=");
  });

  it("adds a marker when requested", () => {
    const url = osmCoordsEmbedUrl("25.0106,-80.3756", 15, true);
    expect(url).toContain("marker=25.0106%2C-80.3756");
  });
});

describe("osmMapEmbedUrl", () => {
  it("renders a framed embed with a marker for coordinate pairs", () => {
    const url = osmMapEmbedUrl("25.0106,-80.3756");
    expect(url).toContain("marker=25.0106%2C-80.3756");
  });

  it("handles free text fallback gracefully", () => {
    const url = osmMapEmbedUrl("12 Dock Road, Key Largo FL");
    expect(url).toContain("https://www.openstreetmap.org/export/embed.html?layer=mapnik");
  });
});

describe("openMapsUrl", () => {
  it("deep-links directly to coordinates with pin and zoom", () => {
    expect(openMapsUrl("25.0106,-80.3756")).toBe(
      "https://www.openstreetmap.org/?mlat=25.0106&mlon=-80.3756#map=16/25.0106/-80.3756",
    );
  });

  it("searches by query string for postal addresses", () => {
    expect(openMapsUrl("12 Dock Road, Key Largo FL")).toBe(
      "https://www.openstreetmap.org/search?query=12%20Dock%20Road%2C%20Key%20Largo%20FL",
    );
  });
});

describe("backward-compatibility aliases", () => {
  it("googleMapsUrl proxies to openMapsUrl", () => {
    expect(googleMapsUrl("25.0106,-80.3756")).toBe(openMapsUrl("25.0106,-80.3756"));
  });

  it("googleTerrainEmbedUrl proxies to osmCoordsEmbedUrl without marker", () => {
    expect(googleTerrainEmbedUrl("25.0106,-80.3756", 16)).toBe(
      osmCoordsEmbedUrl("25.0106,-80.3756", 16, false),
    );
  });

  it("googleMapEmbedUrl proxies to osmMapEmbedUrl", () => {
    expect(googleMapEmbedUrl("25.0106,-80.3756")).toBe(osmMapEmbedUrl("25.0106,-80.3756"));
  });
});
