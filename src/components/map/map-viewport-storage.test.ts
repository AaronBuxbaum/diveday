// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readMapViewport, writeMapViewport } from "./map-viewport-storage";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("map viewport storage", () => {
  it("restores a camera after navigation while keeping different shops and map views separate", () => {
    const camera = { latitude: 25.1, longitude: -80.2, zoom: 13 };
    writeMapViewport("shop-1:catalog", camera, "25,-80");
    expect(readMapViewport("shop-1:catalog", "25,-80")).toEqual(camera);
    expect(readMapViewport("shop-1:library", "25,-80")).toBeNull();
    expect(readMapViewport("shop-2:catalog", "25,-80")).toBeNull();
  });

  it("restores nothing once the pins differ from the ones the camera was saved against", () => {
    writeMapViewport("shop-1:catalog", { latitude: 25.1, longitude: -80.2, zoom: 13 }, "25,-80");
    expect(readMapViewport("shop-1:catalog", "25,-80;24.5,-81.9")).toBeNull();
    // A camera with no pin key reads as a different pin set.
    sessionStorage.setItem(
      "diveday:map:shop-1:catalog",
      '{"latitude":25.1,"longitude":-80.2,"zoom":13}',
    );
    expect(readMapViewport("shop-1:catalog", "25,-80")).toBeNull();
  });

  it.each([
    "not json",
    "null",
    "{}",
    '{"latitude":91,"longitude":0,"zoom":11}',
    '{"latitude":0,"longitude":0,"zoom":-1}',
    '{"latitude":0,"longitude":0,"zoom":20}',
    '{"latitude":"25","longitude":0,"zoom":11}',
  ])("ignores a malformed stored camera: %s", (serialized) => {
    sessionStorage.setItem("diveday:map:shop-1:catalog", serialized);
    expect(readMapViewport("shop-1:catalog", "")).toBeNull();
  });

  it("keeps maps usable when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readMapViewport("catalog", "")).toBeNull();
    expect(() =>
      writeMapViewport("catalog", { latitude: 25, longitude: -80, zoom: 12 }, ""),
    ).not.toThrow();
  });
});
