// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL } from "@/lib/basemap";
import { createBasemapMap } from "./leaflet-basemap";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createBasemapMap", () => {
  it("draws the shared imagery and labels and follows its own box", async () => {
    const L = await import("leaflet");
    const observed: { callback: ResizeObserverCallback; disconnected: boolean }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        record: { callback: ResizeObserverCallback; disconnected: boolean };
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, disconnected: false };
          observed.push(this.record);
        }
        observe() {}
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
    const container = document.createElement("div");
    document.body.append(container);
    const map = createBasemapMap(L, container, { center: [25, -80], zoom: 10 });
    const urls: string[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) urls.push((layer as unknown as { _url: string })._url);
    });
    expect(urls).toEqual([BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL]);
    expect(map.options.trackResize).toBe(false);

    // A resize is answered in the same frame, and its move ends at once: a
    // moveend 200ms later is the pin jumping into place after the paint.
    const invalidate = vi.spyOn(map, "invalidateSize");
    observed[0]?.callback([], {} as ResizeObserver);
    expect(invalidate).toHaveBeenCalledWith({ pan: true, animate: false, debounceMoveend: false });

    map.remove();
    expect(observed[0]?.disconnected).toBe(true);
    container.remove();
  });
});
