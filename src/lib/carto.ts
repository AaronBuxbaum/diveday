/**
 * CARTO Basemap API key for client-rendered map tiles.
 *
 * CARTO requires authentication on basemaps.cartocdn.com endpoints passed
 * via the `key` query parameter. Without a valid key, tile requests receive
 * an "API Key Required" watermarked tile.
 *
 * Configured purely via the NEXT_PUBLIC_CARTO_API_KEY environment variable.
 * No hardcoded fallback key is embedded in source.
 *
 * The `process.env.NEXT_PUBLIC_CARTO_API_KEY` read below must stay written out
 * literally so Next.js build-time inlining substitutes it properly in client bundles.
 */
export const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim() || undefined;

/**
 * Return the CARTO raster basemap tile URL template with the API key attached.
 */
export function cartoTileUrl(style: string = "light_all"): string {
  const base = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
  return CARTO_API_KEY ? `${base}?key=${encodeURIComponent(CARTO_API_KEY)}` : base;
}
