import { describe, expect, it } from "vitest";
import { CARTO_API_KEY, cartoTileUrl } from "./carto";

describe("carto tile configuration", () => {
  it("defaults CARTO_API_KEY to undefined when environment variable is not set", () => {
    // In test environment without NEXT_PUBLIC_CARTO_API_KEY set, CARTO_API_KEY is undefined
    expect(CARTO_API_KEY).toBeUndefined();
  });

  it("builds the tile URL without key parameter when CARTO_API_KEY is unset", () => {
    const url = cartoTileUrl("light_all");
    expect(url).toBe("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png");
    expect(url).not.toContain("?key=");
    expect(url).not.toContain("api_key=");
  });

  it("supports different styles", () => {
    const url = cartoTileUrl("voyager");
    expect(url).toBe("https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png");
  });
});
