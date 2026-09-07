import { calendarDateInTimezone } from "./calendar-date";
import { nowDate } from "./clock";
import type { DiveMode, DockDayRhythm } from "./diver-planning";
import { fetchTidePredictions } from "./tide-predictions";
import { diveArrivalAt, type TidePreference, type TideWindow, tideWindowAt } from "./tides";
import { hasSailed } from "./trips";

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
  /**
   * How many days the departure runs over. **More than one and this answers
   * nothing**: the rhythm is laid over `startsAt`, and `plannedDives` on a
   * multi-day trip is the total across every day, so a day-two dive would be
   * given a day-one arrival instant and therefore the wrong water. Each day
   * has its own `trip_schedule_days.startsAt` and splitting the dives across
   * them is the real fix; until that exists, saying nothing is the only honest
   * answer a sentence beside a Book button can give.
   */
  scheduleDayCount?: number;
  /**
   * **This departure does not exist yet.** The add panel's composer asks what
   * the water would do for a departure a staffer is still typing, so the
   * sailed check below must not apply: there is no boat, nothing has gone, and
   * the time in the form is a proposal rather than a record. Without this the
   * panel silently answers nothing whenever its own default start time is more
   * than the late-arrival buffer old — which is every morning after about
   * half past nine, and was every run of the e2e fleet, whose frozen clock
   * sits exactly one buffer past the panel's 8:30 AM default.
   */
  proposed?: boolean;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<DepartureTideWindow[]> {
  if ((input.scheduleDayCount ?? 1) > 1) return [];
  // A departure that has sailed gets no tide line. Every one of these is
  // present tense -- "this departure reaches the site on the flood" -- so on a
  // past trip it is a live claim about where a boat is. The marine outlook
  // beside it has been gated to future departures all along
  // (`shouldShowAutomatedForecast`); this is the same rule through the app's
  // one buffered question.
  //
  // A *proposed* departure is exempt, because the claim it would make is
  // hypothetical rather than false -- see `proposed` above.
  if (!input.proposed && hasSailed(input.startsAt, input.now ?? nowDate())) return [];
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
