import type { Layer, Map as LeafletMap, MapOptions, ZoomPanOptions } from "leaflet";
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
  options: MapOptions & { credit?: boolean; holdsCenter?: () => boolean },
): LeafletMap {
  const { credit = true, holdsCenter, ...mapOptions } = options;
  const map = L.map(container, {
    ...mapOptions,
    maxZoom: BASEMAP_MAX_ZOOM,
    trackResize: false,
    attributionControl: false,
  });
  if (credit) L.control.attribution({ prefix: false }).addTo(map);
  const tiles = { maxZoom: BASEMAP_MAX_ZOOM, maxNativeZoom: BASEMAP_MAX_NATIVE_ZOOM };
  L.tileLayer(BASEMAP_IMAGERY_URL, { ...tiles, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
  const rasterLabels = () => {
    L.tileLayer(BASEMAP_LABELS_URL, tiles).addTo(map);
  };
  const key = arcgisApiKey();
  if (key) addVectorLabels(map, key, rasterLabels);
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
 */
function addVectorLabels(map: LeafletMap, key: string, fallBack: () => void): void {
  const pane = map.createPane("basemapLabels");
  pane.style.zIndex = "250";
  pane.style.pointerEvents = "none";

  let removed = false;
  let fellBack = false;
  let layer: Layer | null = null;
  map.on("unload", () => {
    removed = true;
  });
  const recover = () => {
    if (removed || fellBack) return;
    fellBack = true;
    if (layer) {
      try {
        map.removeLayer(layer);
      } catch {
        // A layer that failed while being added has nothing to take down.
      }
    }
    fallBack();
  };

  import("@maplibre/maplibre-gl-leaflet")
    .then(({ maplibreGL }) => {
      if (removed) return;
      const labels = maplibreGL({
        style: vectorLabelsStyleUrl(key),
        pane: "basemapLabels",
        interactive: false,
      } as Parameters<typeof maplibreGL>[0]);
      layer = labels;
      labels.addTo(map);
      labels.getMaplibreMap().on("error", recover);
    })
    .catch(recover);
}
