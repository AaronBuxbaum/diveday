import type { StaffTranslator } from "@/i18n/staff-messages";
import { STAGE_WORD_KEYS, TRIP_STAGES, type TripStage } from "@/lib/trip-stages";
import type { TripTabsCopy } from "./TripTabs";

/** `TripTabs`' words, read once on the server for every trip surface that draws it. */
export function tripTabsCopy(t: StaffTranslator): TripTabsCopy {
  return {
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
