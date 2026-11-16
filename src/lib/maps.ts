/**
 * Map URLs, built from a plain-text location query or coordinates.
 *
 * The meeting point and dive-site maps draw on the shared basemap
 * (`src/lib/basemap.ts`).
 */

/**
 * A link out to Google Maps for directions or map inspection.
 *
 * For giving directions and linking locations, Google Maps is standard and widely supported.
 */
export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`;
}

/**
 * Default external map linkout function: uses Google Maps for directions/location viewing.
 */
export const openMapsUrl = googleMapsUrl;

/**
 * **What the maps ask before they show.**
 *
 * A map that cannot load is not silent: an embedded frame paints the browser's
 * broken-document glyph, and a tile layer paints half a picture, in the middle
 * of the box where routes or meeting points sit. A one-pixel read of the host
 * decides first.
 *
 * Both route and meeting point maps ask the shared basemap tile host.
 */
export const MAP_REACHABILITY_PROBES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0",
] as const;

// Retained by the existing CSP and network-policy tests until that policy is narrowed.
export const ARRIVAL_MAP_PROBES = ["https://tile.openstreetmap.org/0/0/0.png"] as const;
