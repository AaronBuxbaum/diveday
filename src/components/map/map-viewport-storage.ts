export type MapViewport = { latitude: number; longitude: number; zoom: number };

/** Per-tab camera state survives both client navigation and the popup's native links. */
export function readMapViewport(key: string): MapViewport | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(`diveday:map:${key}`) ?? "null");
    if (!value || typeof value !== "object") return null;
    if (!("latitude" in value) || !("longitude" in value) || !("zoom" in value)) return null;
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

export function writeMapViewport(key: string, viewport: MapViewport): void {
  try {
    sessionStorage.setItem(`diveday:map:${key}`, JSON.stringify(viewport));
  } catch {
    // A browser that blocks storage can still use the map normally.
  }
}
