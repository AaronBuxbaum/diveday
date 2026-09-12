import { HOUR_MS, nowMs } from "./clock";
import type { DepthUnit } from "./depth-units";

/**
 * **What a NOAA station id actually names, and whether it is anywhere near the
 * site that claims it** — ADR 20260907-noaa-tide-predictions, amended
 * 2026-09-10 (issue #1468).
 *
 * `tides.ts`'s `isTideStationId` is `/^\d{7}$/` and that is the whole of the
 * validation a station id has ever had. Every seven-digit id answers, and a
 * subordinate station's id looks identical to a harmonic one's, so a staffer
 * who typed the station sixty kilometres down the Keys got a tide sentence on
 * every departure that was confidently about the wrong water and said nothing
 * about it. The seed comment beside the demo's own stations records exactly
 * that failure: NOAA has no station on Molasses Reef, and Vaca Key at Marathon
 * is seven digits and also answers.
 *
 * So a second endpoint, behind the same seam shape as `tide-predictions.ts`'s:
 * `mdapi`'s station record, which carries the station's own name and position.
 * The name is echoed back on the form so a wrong id is legible as a wrong
 * *place* rather than as seven digits nobody can check, and the position is
 * compared with the site's own coordinates so an implausible pairing draws a
 * sentence.
 *
 * **Advice, never a gate.** Nothing here is reached from a save, a readiness
 * rule or an admission rule: the lookup happens in the edit page's render, so
 * a NOAA outage cannot refuse a briefing, and every failure answers `null`,
 * which renders no sentence at all. The station's own metadata does not change,
 * so the cache lives a day rather than half of one.
 */

type Fetcher = typeof fetch;

/** Station metadata is effectively static; a day is short only against a rename. */
const STATION_CACHE_TTL_MS = 24 * HOUR_MS;
/** How long a failed lookup is remembered, so an outage cannot be re-asked per render. */
const STATION_FAILURE_TTL_MS = 60_000;
const STATION_CACHE_MAX_ENTRIES = 256;
const STATION_FETCH_TIMEOUT_MS = 4_000;

/** One NOAA CO-OPS station as its own record describes it. */
export type TideStation = {
  id: string;
  name: string;
  /** NOAA's two-letter state code, absent on a few offshore stations. */
  state: string | null;
  latitude: number;
  longitude: number;
};

/** How far a station can sit from the site that reads it before the form says so. */
export type TideStationCheck = {
  /** Kilometres between the station and the site, or `null` when the site has no coordinates. */
  distanceKm: number | null;
  /** Whether that distance is worth a second look. Never a refusal. */
  far: boolean;
};

/** The station a site points at, with what it looks like against that site's own position. */
export type TideStationEcho = TideStation & TideStationCheck;

type StationsResponse = { stations?: unknown };

/**
 * Farther than this and the pairing is worth a second look.
 *
 * The mistake this exists to catch is the one the demo's own seed comment
 * names — a Key Largo reef reading Vaca Key at Marathon, eighty kilometres
 * down the chain. A genuinely nearest ocean-side station is normally inside
 * twenty-five, and the demo's own Carysfort pairing is twenty-nine. Forty
 * catches the first without nagging the second. It is one number to move if a
 * shop with a genuinely remote site reports it, because the cost of being
 * wrong here is one sentence a staffer reads and ignores.
 */
export const IMPLAUSIBLE_STATION_DISTANCE_KM = 40;

const EARTH_MEAN_RADIUS_KM = 6371;
const MILES_PER_KM = 0.621371;

function stationUrl(stationId: string) {
  return `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${stationId}.json`;
}

/** NOAA sends `lat`/`lng` as numbers; a numeric string is accepted the way `parsePrediction` accepts `v`. */
function coordinate(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

/**
 * The first station in an `mdapi` response, or `null`.
 *
 * Shape first and no coerced fallback: a record without a name or without a
 * readable position cannot say anything the form wants, and half a station
 * echoed back would read as a confirmation of an id nothing confirmed.
 */
export function parseTideStation(payload: unknown, id: string): TideStation | null {
  if (!payload || typeof payload !== "object") return null;
  const { stations } = payload as StationsResponse;
  if (!Array.isArray(stations)) return null;
  const [station] = stations;
  if (!station || typeof station !== "object") return null;
  const { name, state, lat, lng } = station as {
    name?: unknown;
    state?: unknown;
    lat?: unknown;
    lng?: unknown;
  };
  if (typeof name !== "string" || name.trim() === "") return null;
  const latitude = coordinate(lat);
  const longitude = coordinate(lng);
  if (latitude === null || longitude === null) return null;
  return {
    id,
    name: name.trim(),
    state: typeof state === "string" && state.trim() !== "" ? state.trim() : null,
    latitude,
    longitude,
  };
}

type CachedStation = { expiresAt: number; value: Promise<TideStation | null> };
const stationCaches = new WeakMap<Fetcher, Map<string, CachedStation>>();

function cacheFor(fetcher: Fetcher) {
  const existing = stationCaches.get(fetcher);
  if (existing) return existing;
  const created = new Map<string, CachedStation>();
  stationCaches.set(fetcher, created);
  return created;
}

/**
 * The station the e2e fleet and an offline dev server see: Carysfort Reef,
 * whatever id is asked for.
 *
 * Same belt as `fixtureTidePredictions` and for the same reason — the fleet has
 * no route out, and the echo has to be on screen for the dive-site baseline to
 * be about anything. One station for every id keeps it deterministic, and
 * Carysfort is the station the demo's Key Largo sites genuinely read: Molasses
 * Reef sits twenty-nine kilometres from it and the Spiegel Grove nineteen,
 * both well inside the threshold, so the fixture never draws a warning that is
 * not real.
 */
export function fixtureTideStation(stationId: string): TideStation {
  return {
    id: stationId,
    name: "Carysfort Reef",
    state: "FL",
    latitude: 25.2217,
    longitude: -80.2117,
  };
}

/**
 * What NOAA calls one station, or `null`.
 *
 * Cached on the id alone — a station's name and position do not depend on the
 * day — with the in-flight promise itself cached, so a page that renders the
 * same site twice asks once.
 */
export async function fetchTideStation(
  stationId: string,
  fetcher: Fetcher = fetch,
): Promise<TideStation | null> {
  // The same belt `fetchTidePredictions` carries, for the same reasons: the
  // flag is set only by `scripts/dev-server.mjs` and `playwright.config.ts`,
  // and `DIVEDAY_E2E` rather than `NODE_ENV` is what separates the fleet from
  // a real deployment, because `pnpm e2e:build` runs `next build` and so *is*
  // production by that measure.
  const fixtureAllowed = process.env.DIVEDAY_E2E === "1" || process.env.NODE_ENV !== "production";
  if (fixtureAllowed && process.env.DIVEDAY_DISABLE_EXTERNAL_HTTP === "1" && fetcher === fetch) {
    return fixtureTideStation(stationId);
  }
  const cache = cacheFor(fetcher);
  const cached = cache.get(stationId);
  if (cached && cached.expiresAt > nowMs()) return cached.value;
  cache.delete(stationId);

  const value = (async () => {
    try {
      const response = await fetcher(stationUrl(stationId), {
        cache: "no-store",
        signal: AbortSignal.timeout(STATION_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return parseTideStation(await response.json(), stationId);
    } catch {
      return null;
    }
  })();
  if (cache.size >= STATION_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(stationId, { expiresAt: nowMs() + STATION_CACHE_TTL_MS, value });
  const resolved = await value;
  // A failure is remembered briefly rather than for the day: a blip costs one
  // render, an outage costs one request a minute per station. Guarded on
  // identity so a newer entry, or an eviction while this was in flight, is
  // left alone.
  if (resolved === null && cache.get(stationId)?.value === value) {
    cache.set(stationId, { expiresAt: nowMs() + STATION_FAILURE_TTL_MS, value });
  }
  return resolved;
}

/** Great-circle kilometres between two points, mean earth radius. */
export function stationDistanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A distance in the unit the shop already reads depth in, whole units.
 *
 * There is no separate distance-unit concept in the repository and inventing
 * one for a single advisory sentence would be a setting nobody asked for: a
 * shop that reads feet reads miles.
 */
export function stationDistanceInUnit(distanceKm: number, unit: DepthUnit): number {
  return Math.round(unit === "feet" ? distanceKm * MILES_PER_KM : distanceKm);
}

/** NOAA's own name for the station, with its state when it has one. */
export function stationLabel(station: TideStation): string {
  return station.state ? `${station.name}, ${station.state}` : station.name;
}

/**
 * How far the station sits from the site that reads it.
 *
 * A site with no coordinates answers `null` and `far: false`: a site that has
 * not said where it is cannot contradict anything, and the form has no business
 * turning a missing latitude into a warning about a tide station.
 */
export function checkStationAgainstSite(
  station: TideStation | null,
  site: { forecastLatitude: number | null; forecastLongitude: number | null },
): TideStationCheck {
  if (!station || site.forecastLatitude === null || site.forecastLongitude === null) {
    return { distanceKm: null, far: false };
  }
  const distanceKm = stationDistanceKm(station, {
    latitude: site.forecastLatitude,
    longitude: site.forecastLongitude,
  });
  return { distanceKm, far: distanceKm > IMPLAUSIBLE_STATION_DISTANCE_KM };
}

/** The station a site points at and what it looks like beside that site, or `null` for no sentence. */
export function tideStationEcho(
  station: TideStation | null,
  site: { forecastLatitude: number | null; forecastLongitude: number | null },
): TideStationEcho | null {
  if (!station) return null;
  return { ...station, ...checkStationAgainstSite(station, site) };
}
