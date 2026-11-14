import { describe, expect, it } from "vitest";
import { appleMapsUrl, directionsUrl, googleMapsUrl, openMapsUrl, openStreetMapUrl } from "./maps";

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
