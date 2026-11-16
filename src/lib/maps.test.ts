import { describe, expect, it } from "vitest";
import { googleMapsUrl, openMapsUrl } from "./maps";

describe("googleMapsUrl and directions linkouts", () => {
  it("creates Google Maps search URL for coordinates or text", () => {
    expect(googleMapsUrl("25.0106,-80.3756")).toBe(
      "https://www.google.com/maps/search/?api=1&query=25.0106%2C-80.3756",
    );
    expect(googleMapsUrl("12 Dock Road, Key Largo FL")).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%20Dock%20Road%2C%20Key%20Largo%20FL",
    );
  });

  it("openMapsUrl defaults to googleMapsUrl", () => {
    expect(openMapsUrl("25.0106,-80.3756")).toBe(googleMapsUrl("25.0106,-80.3756"));
  });
});
