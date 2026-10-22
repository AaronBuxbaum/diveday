/**
 * **The one basemap every DiveDay map draws on** (the dive-site library and
 * catalog, the route editor, the trip briefing's route).
 *
 * Esri World Imagery under Esri's place labels. A dive map is mostly water,
 * and a road style paints water one flat fill: CARTO Positron drew the reef a
 * shop wanted to point at as a gray square once zoomed in. Imagery shows the
 * shallows, the reef edge and the drop-off, which is what a diver reads a dive
 * site map for, and it is the picture a route is drawn against.
 *
 * Keyless today: the legacy `server.arcgisonline.com` tile service answers
 * without a token. Esri's terms ask for the credit below on every map.
 *
 * Codes and URLs only, no sentences: the credit is the provider's own wording.
 */

const ESRI_HOST = "https://server.arcgisonline.com";

export const BASEMAP_IMAGERY_URL = `${ESRI_HOST}/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
export const BASEMAP_LABELS_URL = `${ESRI_HOST}/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;

/** Every origin a basemap tile comes from (the CSP and the test tile stub read it). */
export const BASEMAP_TILE_HOSTS = [ESRI_HOST] as const;

/**
 * Imagery is cached to level 18 nearly everywhere a shop dives; past it a tile
 * is "Map data not yet available", so level 19 scales level 18 up instead.
 */
export const BASEMAP_MAX_NATIVE_ZOOM = 18;
export const BASEMAP_MAX_ZOOM = 19;

/** The provider's credit, as Esri asks for it. */
export const BASEMAP_CREDIT =
  "Powered by Esri · Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** The credit with the provider linked, for Leaflet's attribution control. */
export const BASEMAP_ATTRIBUTION =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a> · Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/**
 * The square a briefing frames around a site at a stored route zoom.
 *
 * The same box the OpenStreetMap export embed used to frame (`bbox`, then a
 * whole-zoom fit), so a waypoint stored as a percentage of that frame points
 * at the same water now: width twice the height in degrees, centered on the
 * site.
 */
export function routeFrameBounds(
  latitude: number,
  longitude: number,
  zoom: number,
): [[number, number], [number, number]] {
  const delta = 360 / 2 ** zoom;
  return [
    [latitude - delta / 2, longitude - delta],
    [latitude + delta / 2, longitude + delta],
  ];
}
