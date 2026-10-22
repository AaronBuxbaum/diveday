import { describe, expect, it } from "vitest";
import { shopMapAnchor } from "./shop-map-anchor";

describe("shopMapAnchor", () => {
  it("labels the shop's recorded coordinates", () => {
    expect(shopMapAnchor({ name: "Blue Mantis", latitude: 25.0865, longitude: -80.4473 })).toEqual({
      name: "Blue Mantis",
      latitude: 25.0865,
      longitude: -80.4473,
    });
  });

  it("accepts zero latitude and longitude as recorded positions", () => {
    expect(shopMapAnchor({ name: "Equator", latitude: 0, longitude: 0 })).toEqual({
      name: "Equator",
      latitude: 0,
      longitude: 0,
    });
  });

  it.each([
    { latitude: null, longitude: -80.4473 },
    { latitude: 25.0865, longitude: null },
    { latitude: null, longitude: null },
    { latitude: undefined, longitude: undefined },
  ])("omits an unrecorded position instead of guessing: %j", (coordinates) => {
    const shop = {
      name: "Blue Mantis",
      ...coordinates,
      timezone: "America/New_York",
      firstSite: { latitude: 25.0527, longitude: -80.3337 },
    };
    expect(shopMapAnchor(shop)).toBeNull();
  });
});
