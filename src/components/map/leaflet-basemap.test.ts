// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL, vectorLabelsStyleUrl } from "@/lib/basemap";
import { createBasemapMap } from "./leaflet-basemap";

/** The vector label layer, faked: jsdom has no WebGL for MapLibre to draw with. */
const vectorLabels = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  errorHandlers: [] as (() => void)[],
}));
vi.mock("@maplibre/maplibre-gl-leaflet", async () => {
  const L = await import("leaflet");
  return {
    maplibreGL: (options: Record<string, unknown>) => {
      vectorLabels.options.push(options);
      const layer = new L.Layer();
      return Object.assign(layer, {
        onAdd: () => layer,
        onRemove: () => layer,
        getMaplibreMap: () => ({
          on: (_event: string, handler: () => void) => vectorLabels.errorHandlers.push(handler),
        }),
      });
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vectorLabels.options.length = 0;
  vectorLabels.errorHandlers.length = 0;
});

const tileUrls = (L: typeof import("leaflet"), map: import("leaflet").Map) => {
  const urls: string[] = [];
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) urls.push((layer as unknown as { _url: string })._url);
  });
  return urls;
};

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
    vi.stubEnv("NEXT_PUBLIC_ARCGIS_API_KEY", "");
    const map = createBasemapMap(L, container, { center: [25, -80], zoom: 10 });
    expect(tileUrls(L, map)).toEqual([BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL]);
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

  // Raster labels are a picture of text, blurred on a retina screen (Aaron,
  // 2026-10-23); with a key the names are drawn as text instead.
  it("draws the place names as vector text with a key, and puts the raster labels back if that fails", async () => {
    const L = await import("leaflet");
    vi.stubEnv("NEXT_PUBLIC_ARCGIS_API_KEY", " test-key ");
    const container = document.createElement("div");
    document.body.append(container);
    const map = createBasemapMap(L, container, { center: [25, -80], zoom: 10 });
    expect(tileUrls(L, map)).toEqual([BASEMAP_IMAGERY_URL]);

    await vi.waitFor(() => expect(vectorLabels.options).toHaveLength(1));
    expect(vectorLabels.options[0]).toMatchObject({
      style: vectorLabelsStyleUrl("test-key"),
      pane: "basemapLabels",
      interactive: false,
    });
    const pane = map.getPane("basemapLabels");
    // Over the imagery (tile pane 200), under every overlay and marker (400+).
    expect(Number(pane?.style.zIndex)).toBeGreaterThan(200);
    expect(Number(pane?.style.zIndex)).toBeLessThan(400);
    expect(pane?.style.pointerEvents).toBe("none");

    // A refused style, a blocked host, no WebGL: the raster labels come back, once.
    vectorLabels.errorHandlers[0]?.();
    vectorLabels.errorHandlers[0]?.();
    expect(tileUrls(L, map)).toEqual([BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL]);

    map.remove();
    container.remove();
  });
});
