import type { Map as LeafletMap } from "leaflet";
import { createBasemapMap } from "./leaflet-basemap";

export function createInteractiveMap(
  L: typeof import("leaflet"),
  container: HTMLElement,
  options: Parameters<typeof createBasemapMap>[2],
) {
  const map = createBasemapMap(L, container, { ...options, scrollWheelZoom: false });
  enableModifierWheelZoom(map, container);
  return map;
}

/** Let a page scroll through the map, while Leaflet handles modified wheels. */
function enableModifierWheelZoom(map: LeafletMap, container: HTMLElement) {
  const onWheel = (event: WheelEvent) => {
    if (event.metaKey || event.ctrlKey) map.scrollWheelZoom.enable();
    else map.scrollWheelZoom.disable();
  };
  container.addEventListener("wheel", onWheel, { capture: true, passive: true });
  map.on("unload", () => {
    container.removeEventListener("wheel", onWheel, true);
    // Leaflet removes its listener but leaves its debounced zoom pending.
    const wheel = map.scrollWheelZoom as typeof map.scrollWheelZoom & { _timer?: number };
    window.clearTimeout(wheel._timer);
  });
}
