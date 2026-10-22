export type MapViewport = { latitude: number; longitude: number; zoom: number };

/** The pins a camera was taken against, in one comparable string. */
export function mapCoordinateKey(coordinates: readonly (readonly [number, number])[]): string {
  return coordinates
    .map(([latitude, longitude]) => `${String(latitude)},${String(longitude)}`)
    .join(";");
}

/**
 * Per-tab camera state survives both client navigation and the popup's native links, but only
 * for the same pins: a camera saved against another pin set reads as nothing, so the map fits
 * the pins it has now.
 */
export function readMapViewport(key: string, coordinates: string): MapViewport | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(`diveday:map:${key}`) ?? "null");
    if (!value || typeof value !== "object") return null;
    if (!("latitude" in value) || !("longitude" in value) || !("zoom" in value)) return null;
    if (!("coordinates" in value) || value.coordinates !== coordinates) return null;
    const { latitude, longitude, zoom } = value;
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      Math.abs(latitude) > 90 ||
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      typeof zoom !== "number" ||
      !Number.isFinite(zoom) ||
      zoom < 0 ||
      zoom > 19
    )
      return null;
    return { latitude, longitude, zoom };
  } catch {
    return null;
  }
}

export function writeMapViewport(key: string, viewport: MapViewport, coordinates: string): void {
  try {
    sessionStorage.setItem(`diveday:map:${key}`, JSON.stringify({ ...viewport, coordinates }));
  } catch {
    // A browser that blocks storage can still use the map normally.
  }
}
