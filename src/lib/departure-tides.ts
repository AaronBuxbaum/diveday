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
  const planned = withStations.flatMap((dive) => {
    const stationId = dive.site.tideStationId;
    if (!stationId) return [];
    const arrival = diveArrivalAt(input.startsAt, input.rhythm, dive.diveNumber, {
      plannedDives: input.plannedDives,
      siteBottomTimes,
      legTravelTimes,
      diveMode: input.diveMode,
    });
    if (!arrival) return [];
    return [{ dive, stationId, arrival }];
  });

  // **Concurrent, and still in the order the dives are planned.** The seam
  // shares one in-flight promise per station and local day, so a two-tank day
  // on one station costs one request either way — but this ran sequentially,
  // and a four-dive itinerary across four stations therefore cost four
  // *serial* four-second timeouts whenever NOAA was unreachable, on the
  // unauthenticated page a diver books from. `Promise.all` keeps the order.
  const tables = await Promise.all(
    planned.map((entry) => fetchTidePredictions(entry.stationId, day, input.fetcher)),
  );

  const results: DepartureTideWindow[] = [];
  planned.forEach((entry, index) => {
    const predictions = tables[index];
    if (!predictions) return;
    const window = tideWindowAt(predictions, entry.arrival);
    if (!window) return;
    results.push({
      diveNumber: entry.dive.diveNumber,
      siteName: entry.dive.site.name,
      arrival: entry.arrival,
      window,
      preference: entry.dive.site.tidePreference,
    });
  });
  return results;
}
