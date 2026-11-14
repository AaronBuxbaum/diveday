import type { LatLng, Layer, Map as LeafletMap, MapOptions, ZoomPanOptions } from "leaflet";
import {
  arcgisApiKey,
  BASEMAP_ATTRIBUTION,
  BASEMAP_IMAGERY_URL,
  BASEMAP_LABELS_URL,
  BASEMAP_MAX_NATIVE_ZOOM,
  BASEMAP_MAX_ZOOM,
  vectorLabelsStyleUrl,
} from "@/lib/basemap";

/**
 * **Every DiveDay Leaflet map starts here**, so the library, the catalog, the
 * route editor and the briefing share one basemap, one zoom range and one way
 * of following their box (`src/lib/basemap.ts`).
 *
 * **The map follows its own box, in the same frame.** Leaflet's own
 * `trackResize` listens to the window and answers a frame later, so for one
 * paint every marker, the shop's pin and its stem sat half a resize away from
 * their water and then jumped. A `ResizeObserver` runs after layout and before
 * paint, and it also sees a box that changes without the window (a layout
 * breakpoint, a scrollbar, a panel opening). The move it causes ends at once
 * rather than 200ms later, so whatever redraws on `moveend` redraws in that
 * same frame.
 */
export function createBasemapMap(
  L: typeof import("leaflet"),
  container: HTMLElement,
  options: MapOptions & { credit?: boolean; holdsCenter?: () => boolean; privateMap?: boolean },
): LeafletMap {
  const { credit = true, holdsCenter, privateMap = false, ...mapOptions } = options;
  const map = L.map(container, {
    ...mapOptions,
    maxZoom: BASEMAP_MAX_ZOOM,
    trackResize: false,
    attributionControl: false,
  });
  if (credit) L.control.attribution({ prefix: false }).addTo(map);
  const tiles = {
    maxZoom: BASEMAP_MAX_ZOOM,
    maxNativeZoom: BASEMAP_MAX_NATIVE_ZOOM,
    ...(privateMap ? { referrerPolicy: "no-referrer" as const } : {}),
  };
  L.tileLayer(BASEMAP_IMAGERY_URL, { ...tiles, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
  const rasterLabels = () => {
    L.tileLayer(BASEMAP_LABELS_URL, tiles).addTo(map);
  };
  const key = arcgisApiKey();
  // Vector style and its dependent requests cannot set an element-level policy.
  if (key && !privateMap) addVectorLabels(L, map, key, rasterLabels);
  else rasterLabels();

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const holding = holdsCenter?.() ?? false;
      map.invalidateSize({ pan: true, animate: false, debounceMoveend: false });
      // Leaflet keeps the center by whole pixels, so an odd change in width
      // drifts it half a pixel, and a camera restored from the last visit
      // came back a little off. A map holding a reader's camera (`holdsCenter`)
      // gets its exact center back; one that refits itself is left to its fit.
      // A plain `setView` pans by whole pixels and so moves nowhere; `reset`
      // (Leaflet's own option, missing from its types) sets the exact center.
      const drift = map.project(map.getCenter(), zoom).distanceTo(map.project(center, zoom));
      if (holding && map.getZoom() === zoom && drift > 0 && drift <= 1) {
        map.setView(center, zoom, { reset: true } as ZoomPanOptions);
      }
    });
    observer.observe(container);
    map.on("unload", () => observer.disconnect());
  }
  return map;
}

/**
 * **Place names drawn as text, not as a picture of text.** Esri's vector label
 * style, rendered by MapLibre into its own pane over the imagery and under
 * every marker, so a label is as sharp as the screen. Loaded only on a map
 * that has a key, and only after the map is up: the photo does not wait for it.
 *
 * Any failure (no WebGL, the style refused, a blocked host) puts the raster
 * labels back, once, rather than leave a map with no place names.
 *
 * The style is read here before MapLibre sees it. Esri answers a key it
 * will not take with an error document, not a style (Aaron, 2026-10-23: the
 * maps showed `{"error":{"code":498,"message":"Token Invalid."}}`), and that
 * answer is the raster labels, quietly, with one console line for whoever
 * looks: never Esri's error.
 */
function addVectorLabels(
  L: typeof import("leaflet"),
  map: LeafletMap,
  key: string,
  fallBack: () => void,
): void {
  const pane = map.createPane("basemapLabels");
  pane.style.zIndex = "250";
  pane.style.pointerEvents = "none";

  let removed = false;
  let fellBack = false;
  let layer: Layer | null = null;
  map.on("unload", () => {
    removed = true;
  });
  const recover = (reason?: string) => {
    if (removed || fellBack) return;
    fellBack = true;
    if (reason) console.warn(`${reason}; drawing raster place labels.`);
    if (layer) {
      try {
        map.removeLayer(layer);
      } catch {
        // A layer that failed while being added has nothing to take down.
      }
    }
    fallBack();
  };

  Promise.all([labelLayerModule(), labelStyle(key)])
    .then(([{ maplibreGL }, style]) => {
      if (removed) return;
      // MapLibre needs WebGL2, and a layer that fails while being added stays
      // half-registered on the map and throws when the map is taken down.
      if (!style) return recover();
      if (!hasWebGL2()) return recover("WebGL2 is unavailable in this page");
      const labels = maplibreGL({
        style,
        pane: "basemapLabels",
        interactive: false,
      } as Parameters<typeof maplibreGL>[0]);
      layer = labels;
      guardLateFrames(L, labels);
      labels.addTo(map);
      labels
        .getMaplibreMap()
        .on("error", () => recover("MapLibre could not load the vector label renderer"));
    })
    .catch(() => recover("The vector label renderer failed to initialize"));
}

/** The parts of the MapLibre layer's internals that `guardLateFrames` touches. */
type LabelLayerInternals = {
  _map: LeafletMap | null;
  _glMap: {
    _actualCanvas: HTMLElement;
    once(event: string, handler: () => void): void;
    jumpTo(options: { center: LatLng; zoom: number }): void;
  } | null;
  _resizeContainer(): void;
  _zoomEnd(): void;
  _transitionEnd(event?: unknown): void;
};

/**
 * **The layer redraws a frame after a resize, and the map may be gone by then.**
 * `@maplibre/maplibre-gl-leaflet` answers Leaflet's `resize` by waiting for an
 * animation frame and then reading the map's zoom. Leaving the page in that
 * frame removes the layer first and nulls its map, and the frame threw
 * `Cannot read properties of null (reading 'getZoom')` (Sentry). The same
 * redraw, skipped when the layer or its map is already gone.
 */
function guardLateFrames(L: typeof import("leaflet"), layer: Layer): void {
  const label = layer as unknown as LabelLayerInternals;
  label._transitionEnd = function (this: LabelLayerInternals) {
    L.Util.requestAnimFrame(() => {
      const map = this._map;
      const gl = this._glMap;
      if (!map || !gl) return;
      const zoom = map.getZoom();
      const center = map.getCenter();
      const offset = map.latLngToContainerPoint(map.getBounds().getNorthWest());
      this._resizeContainer();
      L.DomUtil.setTransform(gl._actualCanvas, offset, 1);
      gl.once("moveend", () => {
        if (this._map) this._zoomEnd();
      });
      gl.jumpTo({ center, zoom: zoom - 1 });
    }, this);
  };
}

let labelLayerImport: Promise<typeof import("@maplibre/maplibre-gl-leaflet")> | null = null;

/** MapLibre and its Leaflet layer, fetched once, by the first map with a key. */
function labelLayerModule() {
  labelLayerImport ??= Promise.all([
    import("@maplibre/maplibre-gl-leaflet"),
    import("maplibre-gl"),
  ]).then(([adapter, maplibre]) => {
    // Next.js uses Turbopack for client bundles. MapLibre's worker must be
    // exposed as a bundled URL before the Leaflet adapter creates its map.
    maplibre.setWorkerUrl(
      new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString(),
    );
    return adapter;
  });
  return labelLayerImport;
}

/**
 * The label style, read once per page and per key: every map on a page shares
 * the answer, so a key Esri refuses is asked about once. Null when the answer
 * is not a style.
 */
let labelStyleRead: { key: string; style: Promise<object | null> } | null = null;

function labelStyle(key: string): Promise<object | null> {
  if (labelStyleRead?.key !== key) {
    labelStyleRead = { key, style: readLabelStyle(key) };
  }
  return labelStyleRead.style;
}

async function readLabelStyle(key: string): Promise<object | null> {
  try {
    const response = await fetch(vectorLabelsStyleUrl(key));
    const body: unknown = await response.json();
    if (response.ok && isStyle(body)) return body;
    // The code and message only: the request URL carries the key.
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    console.warn(
      `Esri refused the place-label style (${String(error?.code ?? response.status)} ${String(error?.message ?? "")}); drawing the raster labels.`,
    );
    return null;
  } catch {
    console.warn("Could not fetch Esri's vector label style; drawing raster place labels.");
    return null;
  }
}

function isStyle(body: unknown): body is object {
  return (
    typeof body === "object" &&
    body !== null &&
    !("error" in body) &&
    Array.isArray((body as { layers?: unknown }).layers)
  );
}

function hasWebGL2(): boolean {
  try {
    const context = document.createElement("canvas").getContext("webgl2");
    if (!context) return false;
    // This probe is temporary; release its context before MapLibre creates its own.
    context.getExtension?.("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Tests only: forget the page's label style answer. */
export function forgetLabelStyle(): void {
  labelStyleRead = null;
}
