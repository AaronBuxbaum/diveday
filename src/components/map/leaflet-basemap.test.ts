// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL, vectorLabelsStyleUrl } from "@/lib/basemap";
import { createBasemapMap, forgetLabelStyle } from "./leaflet-basemap";

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

/** Esri's answer to the label style request. */
const answer = (status: number, body: unknown) => {
  const fetchStyle = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchStyle);
  return fetchStyle;
};
/** jsdom has no WebGL; the vector cases pretend the browser does. */
const withWebGL2 = () =>
  vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(((kind: string) =>
      kind === "webgl2" ? ({} as WebGL2RenderingContext) : null) as never);
const STYLE = { version: 8, sources: {}, layers: [{ id: "place-names", type: "symbol" }] };

afterEach(() => {
  forgetLabelStyle();
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
    const fetchStyle = answer(200, STYLE);
    withWebGL2();
    const container = document.createElement("div");
    document.body.append(container);
    const map = createBasemapMap(L, container, { center: [25, -80], zoom: 10 });
    expect(tileUrls(L, map)).toEqual([BASEMAP_IMAGERY_URL]);

    await vi.waitFor(() => expect(vectorLabels.options).toHaveLength(1));
    expect(fetchStyle).toHaveBeenCalledWith(vectorLabelsStyleUrl("test-key"));
    expect(vectorLabels.options[0]).toMatchObject({
      style: STYLE,
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

  // Aaron, 2026-10-23: a key Esri would not take put its error document on the
  // maps. That answer is the raster labels, with nothing of Esri's shown.
  it.each([
    [
      "a refused key, as an error document",
      200,
      { error: { code: 498, message: "Token Invalid.", details: ["The token is invalid."] } },
    ],
    ["a refused key, as an error status", 498, { error: { code: 498, message: "Token Invalid." } }],
    ["an answer that is not a style", 200, { hello: "world" }],
  ])("draws the raster labels and never hands MapLibre %s", async (_case, status, body) => {
    const L = await import("leaflet");
    vi.stubEnv("NEXT_PUBLIC_ARCGIS_API_KEY", "refused-key");
    answer(status, body);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.append(container);
    const map = createBasemapMap(L, container, { center: [25, -80], zoom: 10 });

    await vi.waitFor(() =>
      expect(tileUrls(L, map)).toEqual([BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL]),
    );
    expect(vectorLabels.options).toHaveLength(0);
    // Whoever opens the console learns why, and never sees the key.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("refused-key");

    map.remove();
    container.remove();
  });

  it("asks Esri about a key once for every map on the page", async () => {
    const L = await import("leaflet");
    vi.stubEnv("NEXT_PUBLIC_ARCGIS_API_KEY", "test-key");
    const fetchStyle = answer(200, STYLE);
    withWebGL2();
    const containers = [document.createElement("div"), document.createElement("div")];
    const maps = containers.map((container) => {
      document.body.append(container);
      return createBasemapMap(L, container, { center: [25, -80], zoom: 10 });
    });
    await vi.waitFor(() => expect(vectorLabels.options).toHaveLength(2));
    expect(fetchStyle).toHaveBeenCalledTimes(1);
    for (const map of maps) map.remove();
    for (const container of containers) container.remove();
  });

  it("draws the raster labels on a browser without WebGL2, and the map still comes down", async () => {
    const L = await import("leaflet");
    vi.stubEnv("NEXT_PUBLIC_ARCGIS_API_KEY", "test-key");
    answer(200, STYLE);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const container = document.createElement("div");
    document.body.append(container);
    const map = createBasemapMap(L, container, { center: [25, -80], zoom: 10 });
    await vi.waitFor(() =>
      expect(tileUrls(L, map)).toEqual([BASEMAP_IMAGERY_URL, BASEMAP_LABELS_URL]),
    );
    expect(vectorLabels.options).toHaveLength(0);
    expect(() => map.remove()).not.toThrow();
    container.remove();
  });
});
