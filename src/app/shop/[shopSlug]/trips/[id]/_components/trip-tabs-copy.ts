import type { StaffTranslator } from "@/i18n/staff-messages";
import { dockCallAt } from "@/lib/dock-call";
import { formatTime } from "@/lib/format";
import { STAGE_WORD_KEYS, TRIP_STAGES, type TripStage } from "@/lib/trip-stages";
import type { TripTabsCopy } from "./TripTabs";

/**
 * `TripTabs`' words, read once on the server for every trip surface that draws
 * it. `checkIn` is passed by the Divers page while `checkInOpen` holds (UX
 * review 2026-10-13, item 20): the desk's one clock word, "Check-in open · at
 * the dock by 11:00 PM", worded here so the route file stays its sections.
 */
export function tripTabsCopy(
  t: StaffTranslator,
  checkIn?: {
    trip: { startsAt: Date };
    shop: { dockCallMinutes: number; timezone: string };
    locale: string;
  },
): TripTabsCopy {
  return {
    checkInLine: checkIn
      ? t("trips.checkInOpen", {
          time: formatTime(
            dockCallAt(checkIn.trip.startsAt, checkIn.shop.dockCallMinutes) ??
              checkIn.trip.startsAt,
            checkIn.locale,
            checkIn.shop.timezone,
          ),
        })
      : null,
    tabsLabel: t("trips.tabs.label"),
    tabs: {
      divers: t("trips.tabs.divers"),
      boat: t("trips.tabs.boat"),
      gear: t("trips.tabs.gear"),
      details: t("trips.tabs.details"),
    },
    stageLabel: t("trips.stageLabel"),
    stages: Object.fromEntries(
      TRIP_STAGES.map((stage) => [stage, t(STAGE_WORD_KEYS[stage])]),
    ) as Record<TripStage, string>,
  };
}
