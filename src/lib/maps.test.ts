import { describe, expect, it } from "vitest";
import {
  appleMapsUrl,
  directionsUrl,
  googleMapEmbedUrl,
  googleMapsUrl,
  googleTerrainEmbedUrl,
  openMapsUrl,
  openStreetMapUrl,
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

describe("googleMapsUrl and directions linkouts", () => {
  it("creates Google Maps search URL for coordinates or text", () => {
    expect(googleMapsUrl("25.0106,-80.3756")).toBe(
      "https://www.google.com/maps/search/?api=1&query=25.0106%2C-80.3756",
    );
    expect(googleMapsUrl("12 Dock Road, Key Largo FL")).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%20Dock%20Road%2C%20Key%20Largo%20FL",
    );
  });

  it("creates Apple Maps search URL", () => {
    expect(appleMapsUrl("12 Dock Road, Key Largo FL")).toBe(
      "https://maps.apple.com/?q=12%20Dock%20Road%2C%20Key%20Largo%20FL",
    );
  });

  it("creates OpenStreetMap URL", () => {
    expect(openStreetMapUrl("25.0106,-80.3756")).toBe(
      "https://www.openstreetmap.org/?mlat=25.0106&mlon=-80.3756#map=16/25.0106/-80.3756",
    );
  });

  it("directionsUrl routes to chosen provider with google as default", () => {
    expect(directionsUrl("25.0106,-80.3756")).toBe(googleMapsUrl("25.0106,-80.3756"));
    expect(directionsUrl("25.0106,-80.3756", "apple")).toBe(appleMapsUrl("25.0106,-80.3756"));
    expect(directionsUrl("25.0106,-80.3756", "osm")).toBe(openStreetMapUrl("25.0106,-80.3756"));
  });

  it("openMapsUrl defaults to googleMapsUrl", () => {
    expect(openMapsUrl("25.0106,-80.3756")).toBe(googleMapsUrl("25.0106,-80.3756"));
  });
});

describe("backward-compatibility aliases", () => {
  it("googleTerrainEmbedUrl proxies to osmCoordsEmbedUrl without marker", () => {
    expect(googleTerrainEmbedUrl("25.0106,-80.3756", 16)).toBe(
      osmCoordsEmbedUrl("25.0106,-80.3756", 16, false),
    );
  });

  it("googleMapEmbedUrl proxies to osmMapEmbedUrl", () => {
    expect(googleMapEmbedUrl("25.0106,-80.3756")).toBe(osmMapEmbedUrl("25.0106,-80.3756"));
  });
});
