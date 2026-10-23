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
 * The imagery comes from the keyless legacy `server.arcgisonline.com` tile
 * service. Its place labels are baked into 256px pictures, which a retina
 * screen scales up and blurs (Aaron, 2026-10-23: "the font within the map
 * seems strangely pixelated"). With `NEXT_PUBLIC_ARCGIS_API_KEY` set, the
 * labels come from Esri's vector style instead and are drawn as text at the
 * screen's own density; without it, or when that style fails, the raster
 * labels stay. Esri's terms ask for the credit below on every map.
 *
 * Codes and URLs only, no sentences: the credit is the provider's own wording.
 */

const ESRI_HOST = "https://server.arcgisonline.com";

export const BASEMAP_IMAGERY_URL = `${ESRI_HOST}/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
export const BASEMAP_LABELS_URL = `${ESRI_HOST}/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;

/** Every origin a basemap tile comes from (the CSP and the test tile stub read it). */
export const BASEMAP_TILE_HOSTS = [ESRI_HOST] as const;

/**
 * The ArcGIS location-services key, or null without one. Public by design: the
 * browser sends it with every request, so Esri's own control is the referrer
 * restriction on the key, not secrecy.
 */
export function arcgisApiKey(): string | null {
  return process.env.NEXT_PUBLIC_ARCGIS_API_KEY?.trim() || null;
}

/** Esri's place labels for imagery, as a vector style (basemap styles service v2). */
export function vectorLabelsStyleUrl(key: string): string {
  return `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery/labels?token=${encodeURIComponent(key)}`;
}

/**
 * Every source the vector labels read from: the style, its vector tiles, its
 * glyphs and sprites. Fetched rather than drawn as `<img>`, so these go under
 * `connect-src`, and only when a key is configured.
 *
 * The sprites live on `cdn.arcgis.com`, which also serves anyone's published
 * ArcGIS items. The whole host is allowed anyway, so a style Esri moves to a
 * new item keeps its sprites (Aaron, 2026-10-23: "let's just use the hostname").
 */
export const VECTOR_LABEL_HOSTS = [
  "https://basemapstyles-api.arcgis.com",
  "https://basemaps-api.arcgis.com",
  "https://static.arcgis.com",
  "https://cdn.arcgis.com",
] as const;

/**
 * Imagery is cached to level 18 nearly everywhere a shop dives; past it a tile
 * is "Map data not yet available", so level 19 scales level 18 up instead.
 */
export const BASEMAP_MAX_NATIVE_ZOOM = 18;
export const BASEMAP_MAX_ZOOM = 19;

/**
 * The provider's credit, as Esri asks for it: "Powered by Esri" and the
 * imagery's sources. A map shows it on one short line, cut off where it runs
 * long and opened in full on hover or focus, the way Esri's own Leaflet
 * plugin shows it (Aaron, 2026-10-23: the full line was too long).
 */
const BASEMAP_SOURCES = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
export const BASEMAP_CREDIT = `Powered by Esri · ${BASEMAP_SOURCES}`;

/** The credit with the provider linked, for Leaflet's attribution control. */
export const BASEMAP_ATTRIBUTION = `<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a> · ${BASEMAP_SOURCES}`;

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
