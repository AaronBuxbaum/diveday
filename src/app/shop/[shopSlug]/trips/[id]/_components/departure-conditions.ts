import type { getTripOverview } from "@/db/trips";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { staffTideStationText, staffTideWindowText } from "@/i18n/tide-labels";
import { oneWindowPerSite, tideWindowsForDeparture } from "@/lib/departure-tides";
import { parseDockDayRhythm } from "@/lib/diver-planning";
import { formatTime } from "@/lib/format";
import { automatedForecastForDeparture } from "@/lib/marine-forecast";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.

type TripOverview = NonNullable<Awaited<ReturnType<typeof getTripOverview>>>;

/**
 * The Details tab's two streamed readings of the water: the automated outlook
 * at the first forecastable site, and one tide sentence per stationed site at
 * the boat's own arrival there. Both are promises the conditions panel awaits
 * behind its own `<Suspense>`; on the Divers tab neither is started.
 */
export function departureConditionReads({
  showDetails,
  trip,
  tripDiveList,
  scheduleDayCount,
  shop,
  locale,
  t,
}: {
  showDetails: boolean;
  trip: TripOverview["trip"];
  tripDiveList: TripOverview["tripDiveList"];
  scheduleDayCount: number;
  shop: Parameters<typeof parseDockDayRhythm>[0] & { timezone: string };
  locale: string;
  t: StaffTranslator;
}) {
  const siteWithForecast = tripDiveList.find(
    ({ diveSite }) =>
      diveSite && diveSite.forecastLatitude !== null && diveSite.forecastLongitude !== null,
  )?.diveSite;
  // **Started, never awaited here** (code review 2026-10-10, item 1): the outlook and the tide
  // each wait on a provider outside DiveDay, up to four seconds, so the conditions panel streams
  // them in behind its own `<Suspense>`. Neither rejects. Only the Details tab draws the panel.
  const automatedForecast = showDetails
    ? automatedForecastForDeparture(siteWithForecast, trip.startsAt)
    : Promise.resolve(null);
  // One sentence per stationed site, read at the boat's own arrival there
  // (ADR 20260907-noaa-tide-predictions). Empty on most departures.
  const rhythm = parseDockDayRhythm(shop);
  const tideWindows =
    showDetails && rhythm
      ? tideWindowsForDeparture({
          startsAt: trip.startsAt,
          plannedDives: trip.plannedDives,
          diveMode: trip.diveMode,
          dives: tripDiveList.map(({ dive, diveSite }) => ({
            diveNumber: dive.diveNumber,
            travelMinutes: dive.travelMinutes,
            site: diveSite
              ? {
                  name: diveSite.name,
                  tideStationId: diveSite.tideStationId,
                  tidePreference: diveSite.tidePreference,
                  expectedBottomTimeMinutes: diveSite.expectedBottomTimeMinutes,
                }
              : null,
          })),
          rhythm,
          timeZone: shop.timezone,
          scheduleDayCount,
        })
      : Promise.resolve([]);
  // A site dived twice reads its water once (`oneWindowPerSite`).
  const tideLines = tideWindows.then((windows) =>
    oneWindowPerSite(windows).map((entry) => ({
      site: entry.siteName,
      text: staffTideWindowText(
        t,
        entry.window,
        entry.preference,
        formatTime(entry.window.nearestTurn.at, locale, shop.timezone),
      ),
      station: entry.stationLabel ? staffTideStationText(t, entry.stationLabel) : null,
    })),
  );
  return { automatedForecast, tideLines };
}
