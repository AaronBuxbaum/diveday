import type { AppDb } from "@/db/client";
import { getTripOpenSeatsDebrief } from "@/db/open-seats";
import { lastAtSites } from "@/db/site-history";
import { openSeatsDebriefText } from "@/i18n/open-seats-labels";
import { siteHistoryText } from "@/i18n/site-history-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { recurrenceSummary, type WeekdaySet } from "@/lib/recurrence";
import { recurrenceSummaryText } from "./SeriesSection";

/**
 * The Details tab's fact rows, worked out here so the route file stays
 * the page's shape rather than its arithmetic.
 */

/**
 * The "Repeats" row's words: the cadence, and how much of the run is still on
 * the board — a fact the cadence sentence alone does not carry, and the one the
 * "cancel every upcoming date" confirm is counting. It rides on the row rather
 * than on the collapsed strip, which is one truncating line and has the
 * cadence to fit first.
 */
export function repeatsRowText(
  t: StaffTranslator,
  locale: string,
  series: {
    intervalWeeks: number;
    weekdayMask: WeekdaySet;
    endsOn: CalendarDate | null;
    futureScheduledCount: number;
  } | null,
): string {
  if (!series) return t("trips.about.oneTime");
  const summary = recurrenceSummaryText(
    t,
    locale,
    recurrenceSummary({
      intervalWeeks: series.intervalWeeks,
      weekdays: series.weekdayMask,
      endsOn: series.endsOn,
    }),
  );
  return series.futureScheduledCount > 0
    ? t("tripSeries.panel.summaryWithFuture", { summary, count: series.futureScheduledCount })
    : t("tripSeries.panel.summaryAllDone", { summary });
}

/**
 * **Why seats went unsold**, once the boat has sailed short (issue #1207,
 * D47): a fact row with no editor, a post-mortem for whoever plans the next
 * run of this trip, moved off the day spine (UX review 2026-10-10, item 31).
 * No row at all for a departure that filled, has not sailed, or was called
 * off. Read only when the Details tab is drawn.
 */
async function openSeatsDetailsRows({
  db,
  shop,
  tripId,
  t,
  locale,
  shown,
}: {
  db: AppDb;
  shop: { id: string; timezone: string };
  tripId: string;
  t: StaffTranslator;
  locale: string;
  shown: boolean;
}): Promise<{ id: string; label: string; value: string }[]> {
  if (!shown) return [];
  const debrief = await getTripOpenSeatsDebrief(db, shop.id, tripId, shop.timezone);
  if (!debrief) return [];
  const comparableDate = debrief.comparable
    ? formatShortDate(debrief.comparable.startsAt, locale, shop.timezone)
    : "";
  const value = openSeatsDebriefText(t, locale, debrief, { comparableDate });
  return value ? [{ id: "open-seats", label: t("trips.openSeats.label"), value }] : [];
}

/**
 * **What each planned site was like last time** (fifth-loop ideas, item 6):
 * one "Last time" row, a sentence per site the plan names that an earlier
 * departure dived, or left for another site. No row when none was. Read only
 * when the Details tab is drawn.
 */
async function siteHistoryRows({
  db,
  shop,
  overview,
  t,
  locale,
}: {
  db: AppDb;
  shop: { id: string; timezone: string };
  overview: DetailsOverview;
  t: StaffTranslator;
  locale: string;
}): Promise<{ id: string; label: string; value: string }[]> {
  const { trip, diveSites } = overview;
  if (diveSites.sites.length === 0) return [];
  const history = await lastAtSites(db, {
    shopId: shop.id,
    siteIds: diveSites.sites.map((site) => site.id),
    before: trip.startsAt,
    excludeTripId: trip.id,
  });
  const now = nowDate();
  const lines = diveSites.sites.flatMap((site) => {
    const last = history.get(site.id);
    return last
      ? [
          siteHistoryText(t, {
            site: site.name,
            history: last,
            locale,
            timeZone: shop.timezone,
            now,
          }),
        ]
      : [];
  });
  return lines.length > 0
    ? [{ id: "site-history", label: t("trips.siteHistory.label"), value: lines.join(" ") }]
    : [];
}

/** What `detailsReadRows` reads of the departure. */
type DetailsOverview = {
  trip: { id: string; startsAt: Date };
  diveSites: { sites: readonly { id: string; name: string }[] };
};

/**
 * The Details tab's fact rows that need a read of their own, after the rows
 * `tripAboutRows` lays out: the last time a boat went to each planned site,
 * then why seats went unsold. Nothing is read unless the tab is drawn.
 */
export async function detailsReadRows(input: {
  db: AppDb;
  shop: { id: string; timezone: string };
  overview: DetailsOverview;
  t: StaffTranslator;
  locale: string;
  shown: boolean;
}): Promise<{ id: string; label: string; value: string }[]> {
  if (!input.shown) return [];
  const [history, openSeats] = await Promise.all([
    siteHistoryRows(input),
    openSeatsDetailsRows({ ...input, tripId: input.overview.trip.id }),
  ]);
  return [...history, ...openSeats];
}
