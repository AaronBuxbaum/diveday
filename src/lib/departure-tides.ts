import { calendarDateInTimezone } from "./calendar-date";
import type { DiveMode, DockDayRhythm } from "./diver-planning";
import { fetchTidePredictions } from "./tide-predictions";
import { diveArrivalAt, type TidePreference, type TideWindow, tideWindowAt } from "./tides";

/**
 * **The tide at every site a departure visits** — ADR 20260907-noaa-tide-predictions.
 *
 * One composition for the three staff surfaces and the diver's page, so they
 * cannot disagree about which instant the water is read at: each dive's
 * arrival comes from the dock-day rhythm (`diveArrivalAt`), the predictions
 * come through the seam once per station and local day, and a site with no
 * station — or a station that answers nothing — contributes no entry at all.
 * The caller words the entries; nothing here is a sentence.
 */

export type DepartureTideDive = {
  diveNumber: number;
  /** `trip_dives.travel_minutes` for this leg, or null for the shop's figure. */
  travelMinutes: number | null;
  site: {
    name: string;
    tideStationId: string | null;
    tidePreference: TidePreference;
    expectedBottomTimeMinutes: number | null;
  } | null;
};

export type DepartureTideWindow = {
  diveNumber: number;
  siteName: string;
  arrival: Date;
  window: TideWindow;
  preference: TidePreference;
};

export async function tideWindowsForDeparture(input: {
  startsAt: Date;
  plannedDives: number;
  diveMode: DiveMode;
  dives: readonly DepartureTideDive[];
  rhythm: DockDayRhythm;
  timeZone: string;
  fetcher?: typeof fetch;
}): Promise<DepartureTideWindow[]> {
  const withStations = input.dives.filter(
    (dive): dive is DepartureTideDive & { site: NonNullable<DepartureTideDive["site"]> } =>
      Boolean(dive.site?.tideStationId),
  );
  if (withStations.length === 0) return [];
  const day = calendarDateInTimezone(input.startsAt, input.timeZone);
  const legTravelTimes = input.dives.map((dive) => dive.travelMinutes);
  const siteBottomTimes = input.dives.map((dive) => dive.site?.expectedBottomTimeMinutes ?? null);
  const results: DepartureTideWindow[] = [];
  // Sequential on purpose: the seam caches the in-flight promise per station
  // and day, so a two-tank day on one station costs one request either way,
  // and sequential keeps the order the dives are planned in.
  for (const dive of withStations) {
    const stationId = dive.site.tideStationId;
    if (!stationId) continue;
    const arrival = diveArrivalAt(input.startsAt, input.rhythm, dive.diveNumber, {
      plannedDives: input.plannedDives,
      siteBottomTimes,
      legTravelTimes,
      diveMode: input.diveMode,
    });
    if (!arrival) continue;
    const predictions = await fetchTidePredictions(stationId, day, input.fetcher);
    if (!predictions) continue;
    const window = tideWindowAt(predictions, arrival);
    if (!window) continue;
    results.push({
      diveNumber: dive.diveNumber,
      siteName: dive.site.name,
      arrival,
      window,
      preference: dive.site.tidePreference,
    });
  }
  return results;
}
