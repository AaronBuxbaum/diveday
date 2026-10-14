import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  type MeetingPointShopRow,
  type MeetingPointTripRow,
  meetingPointLine,
  meetingPointOfRows,
} from "@/lib/meeting-point";

/**
 * **`TripPlanSection`'s rows, worded** — where the boat meets (UX review
 * 2026-10-13, item 18) and one line per planned dive. Kept out of the route
 * file, which stays the order its sections render in.
 */
export function tripPlanRows(
  t: StaffTranslator,
  shop: MeetingPointShopRow,
  plannedDives: readonly { dive: { diveNumber: number }; diveSite: { name: string } | null }[],
  meetingPoint: MeetingPointTripRow | null,
) {
  return {
    dives: plannedDives.map(({ dive, diveSite }) => ({
      diveNumber: dive.diveNumber,
      line: diveSite
        ? t("manifest.planChange.diveRow", { number: dive.diveNumber, site: diveSite.name })
        : t("manifest.planChange.diveRowNoSite", { number: dive.diveNumber }),
    })),
    meeting: meetingPoint
      ? {
          label: t("trips.about.meetingPoint"),
          line: meetingPointLine(meetingPointOfRows(shop, meetingPoint)),
        }
      : undefined,
  };
}
