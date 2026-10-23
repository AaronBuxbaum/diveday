import type { Map as LeafletMap, MapOptions, ZoomPanOptions } from "leaflet";
import {
  BASEMAP_ATTRIBUTION,
  BASEMAP_IMAGERY_URL,
  BASEMAP_LABELS_URL,
  BASEMAP_MAX_NATIVE_ZOOM,
  BASEMAP_MAX_ZOOM,
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
  options: MapOptions & { credit?: boolean },
): LeafletMap {
  const { credit = true, ...mapOptions } = options;
  const map = L.map(container, {
    ...mapOptions,
    maxZoom: BASEMAP_MAX_ZOOM,
    trackResize: false,
    attributionControl: false,
  });
  if (credit) L.control.attribution({ prefix: false }).addTo(map);
  const tiles = { maxZoom: BASEMAP_MAX_ZOOM, maxNativeZoom: BASEMAP_MAX_NATIVE_ZOOM };
  L.tileLayer(BASEMAP_IMAGERY_URL, { ...tiles, attribution: BASEMAP_ATTRIBUTION }).addTo(map);
  L.tileLayer(BASEMAP_LABELS_URL, tiles).addTo(map);

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      map.invalidateSize({ pan: true, animate: false, debounceMoveend: false });
      // Leaflet keeps the center by whole pixels, so an odd change in width
      // drifts it half a pixel, and a camera restored from the last visit
      // came back a little off. Put the exact center back, unless the resize
      // refitted the view (`SiteMap`'s overview) to somewhere else. A plain
      // `setView` pans by whole pixels and so moves nowhere; `reset` (Leaflet's
      // own option, missing from its types) sets the exact center.
      const drift = map.project(map.getCenter(), zoom).distanceTo(map.project(center, zoom));
      if (map.getZoom() === zoom && drift > 0 && drift <= 1) {
        map.setView(center, zoom, { reset: true } as ZoomPanOptions);
      }
    });
    observer.observe(container);
    map.on("unload", () => observer.disconnect());
  }
  return map;
}
