/**
 * Map URLs, built from a plain-text location query or coordinates.
 *
 * The meeting point and dive-site maps draw on the shared basemap
 * (`src/lib/basemap.ts`).
 *
 * Callers needing a link out for directions or maps exploration consume `openMapsUrl`.
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
 * A link out to Apple Maps for directions or map inspection.
 * Supported on iOS/macOS devices or web fallback.
 */
export function appleMapsUrl(query: string): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(query.trim())}`;
}

/**
 * A link out to OpenStreetMap for directions or map inspection.
 *
 * If coordinates are provided ("lat,lng"), deep-links directly with marker (`mlat`, `mlon`).
 * If text address is provided, deep-links to OpenStreetMap's search.
 */
export function openStreetMapUrl(query: string): string {
  const trimmed = query.trim();
  const parts = trimmed.split(",").map((p) => Number.parseFloat(p.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    const lat = parts[0];
    const lng = parts[1];
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(trimmed)}`;
}

/**
 * URL for opening map locations or directions externally.
 *
 * Defaults to Google Maps for standard external navigation and directions linking,
 * while allowing caller customization or platform-specific linking (e.g. Apple Maps).
 */
export function directionsUrl(
  query: string,
  provider: "google" | "apple" | "osm" = "google",
): string {
  if (provider === "apple") {
    return appleMapsUrl(query);
  }
  if (provider === "osm") {
    return openStreetMapUrl(query);
  }
  return googleMapsUrl(query);
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
