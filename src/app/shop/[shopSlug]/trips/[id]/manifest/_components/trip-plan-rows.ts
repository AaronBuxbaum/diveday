import { siteHistoryText } from "@/i18n/site-history-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import {
  type MeetingPointShopRow,
  type MeetingPointTripRow,
  meetingPointLine,
  meetingPointOfRows,
} from "@/lib/meeting-point";
import type { SiteHistory } from "@/lib/site-history";

/**
 * **`TripPlanSection`'s rows, worded** — where the boat meets (UX review
 * 2026-10-13, item 18) and one line per planned dive. Kept out of the route
 * file, which stays the order its sections render in.
 *
 * Under a dive whose site a boat has been to before, the last time in a
 * sentence (fifth-loop ideas, item 6): the crew's visibility and current, or
 * "moved to French Reef last time". A site never dived says nothing.
 */
export function tripPlanRows(
  t: StaffTranslator,
  shop: MeetingPointShopRow & { timezone: string },
  plannedDives: readonly {
    dive: { diveNumber: number };
    diveSite: { id: string; name: string } | null;
  }[],
  meetingPoint: MeetingPointTripRow | null,
  /** `lastAtSites` for the plan's sites; absent, no dive says its last visit. */
  siteHistory?: ReadonlyMap<string, SiteHistory>,
  locale?: string,
) {
  const now = nowDate();
  return {
    dives: plannedDives.map(({ dive, diveSite }) => {
      const history = diveSite ? siteHistory?.get(diveSite.id) : undefined;
      return {
        diveNumber: dive.diveNumber,
        line: diveSite
          ? t("manifest.planChange.diveRow", { number: dive.diveNumber, site: diveSite.name })
          : t("manifest.planChange.diveRowNoSite", { number: dive.diveNumber }),
        lastTime:
          diveSite && history && locale
            ? siteHistoryText(t, {
                site: diveSite.name,
                history,
                locale,
                timeZone: shop.timezone,
                now,
              })
            : undefined,
      };
    }),
    meeting: meetingPoint
      ? {
          label: t("trips.about.meetingPoint"),
          line: meetingPointLine(meetingPointOfRows(shop, meetingPoint)),
        }
      : undefined,
  };
}
