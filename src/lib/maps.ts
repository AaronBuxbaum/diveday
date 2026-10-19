/**
 * Map URLs, built from a plain-text location query or coordinates.
 *
 * Provider-neutral, open mapping via OpenStreetMap: no proprietary keys, no tracking,
 * and no client SDK dependencies.
 *
 * Callers needing an embed frame (a dive site's terrain briefing, a shop's meeting
 * point on `/ready`) consume `osmMapEmbedUrl` or `osmCoordsEmbedUrl`, which target
 * OpenStreetMap's standard export embed endpoint.
 *
 * Callers needing a link out for directions or maps exploration consume `openMapsUrl`.
 */

/**
 * Bounds around a coordinate for OSM embed framing.
 * Delta in degrees roughly corresponding to standard zoom levels (0.01 deg ~= 1.1km at equator).
 */
function zoomToDegreesDelta(zoom: number): number {
  // Zoom 15 ~= ~0.015 degrees bbox width, zoom 16 ~= ~0.008, etc.
  // Standard zoom level formula: 360 / (2^zoom)
  return 360 / 2 ** zoom;
}

/**
 * The OpenStreetMap export embed URL for coordinate pairs (`lat,lng`).
 *
 * Renders an iframe src with a bounding box centered on the coordinate.
 * When `showMarker` is true, an OSM pin is placed at the center coordinate.
 */
export function osmCoordsEmbedUrl(coordinates: string, zoom = 15, showMarker = false): string {
  const parts = coordinates.split(",").map((p) => Number.parseFloat(p.trim()));
  const lat = parts[0];
  const lng = parts[1];

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return `https://www.openstreetmap.org/export/embed.html?layer=mapnik`;
  }

  const delta = zoomToDegreesDelta(zoom);
  const minLng = (lng - delta).toFixed(5);
  const minLat = (lat - delta / 2).toFixed(5);
  const maxLng = (lng + delta).toFixed(5);
  const maxLat = (lat + delta / 2).toFixed(5);
  const bbox = `${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}`;

  const markerParam = showMarker ? `&marker=${lat}%2C${lng}` : "";
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${markerParam}`;
}

/**
 * The OpenStreetMap embed URL for a text query or coordinate string.
 * If query is coordinate format ("lat,lng"), produces a framed embed with a marker.
 * If textual, centers on a default view.
 */
export function osmMapEmbedUrl(query: string): string {
  const parts = query.split(",").map((p) => Number.parseFloat(p.trim()));
  if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
    return osmCoordsEmbedUrl(query, 15, true);
  }
  // For free-text addresses, pass the query into the embed so that the location
  // context is retained in the frame URL.
  return `https://www.openstreetmap.org/export/embed.html?layer=mapnik&query=${encodeURIComponent(query.trim())}`;
}

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
 * Backward-compatible aliases for existing callers during migration.
 */
export const googleMapEmbedUrl = osmMapEmbedUrl;
export const googleTerrainEmbedUrl = (coords: string, zoom = 15) =>
  osmCoordsEmbedUrl(coords, zoom, false);

/**
 * **What the map frames ask before showing the frame.**
 *
 * A framed map that cannot load is not silent: the browser paints its own
 * broken-document glyph in the middle of the frame, which is where routes or meeting
 * points sit. A one-pixel read of an open mapping host verifies network availability.
 *
 * We probe OpenStreetMap's host asset (favicon.ico) and CARTO tile infrastructure.
 */
export const MAP_REACHABILITY_PROBES = [
  "https://www.openstreetmap.org/favicon.ico",
  "https://a.basemaps.cartocdn.com/rastertiles/voyager/0/0/0.png",
] as const;
