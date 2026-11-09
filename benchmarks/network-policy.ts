import { BASEMAP_TILE_HOSTS } from "../src/lib/basemap";
import { ARRIVAL_MAP_PROBES, MAP_REACHABILITY_PROBES } from "../src/lib/maps";

/** No external dependency and no Playwright routing, which disables the HTTP cache. */
export function measurementNetworkPolicy(
  requestUrl: string,
  workerOrigin: string,
): "continue" | "tile" | "stylesheet" | "frame" | "abort" {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return "abort";
  }
  if (url.origin === workerOrigin) return "continue";
  const refusedProbes: readonly string[] = [...MAP_REACHABILITY_PROBES, ...ARRIVAL_MAP_PROBES];
  if (refusedProbes.includes(url.href)) return "abort";
  if (url.origin === "https://fonts.googleapis.com") return "stylesheet";
  if (url.origin === "https://www.openstreetmap.org" && url.pathname === "/export/embed.html")
    return "frame";
  if (BASEMAP_TILE_HOSTS.some((host) => host === url.origin) && /\/tile\//.test(url.pathname))
    return "tile";
  return "abort";
}

/** Identity, not URL: a new navigation may request the same cached chunk URL. */
export function createRequestWindow<T extends object>() {
  const requests = new WeakSet<T>();
  return {
    start: (request: T) => requests.add(request),
    contains: (request: T) => requests.has(request),
  };
}
