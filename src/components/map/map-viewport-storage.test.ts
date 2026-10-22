// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMapViewport, readMapViewport, writeMapViewport } from "./map-viewport-storage";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("map viewport storage", () => {
  it("restores a camera after navigation while keeping different shops and map views separate", () => {
    const camera = { latitude: 25.1, longitude: -80.2, zoom: 13 };
    writeMapViewport("shop-1:catalog", camera);
    expect(readMapViewport("shop-1:catalog")).toEqual(camera);
    expect(readMapViewport("shop-1:library")).toBeNull();
    expect(readMapViewport("shop-2:catalog")).toBeNull();
  });

  it("forgets one map's camera and leaves the others", () => {
    const camera = { latitude: 25.1, longitude: -80.2, zoom: 13 };
    writeMapViewport("shop-1:library", camera);
    writeMapViewport("shop-1:catalog", camera);
    clearMapViewport("shop-1:library");
    expect(readMapViewport("shop-1:library")).toBeNull();
    expect(readMapViewport("shop-1:catalog")).toEqual(camera);
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
    expect(readMapViewport("shop-1:catalog")).toBeNull();
  });

  it("keeps maps usable when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearMapViewport("catalog")).not.toThrow();
    expect(readMapViewport("catalog")).toBeNull();
    expect(() =>
      writeMapViewport("catalog", { latitude: 25, longitude: -80, zoom: 12 }),
    ).not.toThrow();
  });
});
