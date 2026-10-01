import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripTabsCopy } from "./TripTabs";

/** `TripTabs`' words, read once on the server for every trip surface that draws it. */
export function tripTabsCopy(t: StaffTranslator): TripTabsCopy {
  return {
    tabsLabel: t("trips.tabs.label"),
    tabs: {
      divers: t("trips.tabs.divers"),
      checkin: t("trips.tabs.checkin"),
      boat: t("trips.tabs.boat"),
      gear: t("trips.tabs.gear"),
      details: t("trips.tabs.details"),
    },
    phaseLabel: t("trips.phases.label"),
    phases: {
      prep: t("trips.phases.prep"),
      checkin: t("trips.phases.checkin"),
      aboard: t("trips.phases.aboard"),
      back: t("trips.phases.back"),
    },
  };
}
