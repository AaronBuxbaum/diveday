import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { gearStatusLabels } from "@/i18n/gear-labels";
import type { StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { getAuth } from "@/lib/auth";
import {
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_DESTINATION_TITLE_KEYS,
  type StaffDestinationId,
  type StaffDestinationLabels,
  type StaffDestinationTitles,
} from "@/lib/staff-destinations";
import type { CommandPaletteCopy } from "./search/CommandPalette";

/**
 * What the ⌘K palette is handed wherever it is mounted: the staff bar
 * (`ShopNav`) and the staff 404's field (`ShopSearchField`). Apart from
 * `ShopNav.tsx` so the root not-found, which is in every route's client graph,
 * reaches the palette without the sidebar, tab bar and identity menu beside it
 * (code review 2026-10-13, item 4).
 */

export async function signOutAction() {
  "use server";
  const auth = await getAuth();
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

/**
 * The one word each staff destination goes by, and the headline the page it
 * leads to wears.
 *
 * Both are read straight off the registry's key records, so the nav tab, the
 * palette's "Go to" row and the page's own eyebrow are the same string by
 * construction rather than by three people typing it. Adding a destination
 * without a word is a type error in `STAFF_DESTINATION_LABEL_KEYS`.
 */
function destinationLabelsFor(t: (key: StaffMessageKey) => string): StaffDestinationLabels {
  const entries = Object.entries(STAFF_DESTINATION_LABEL_KEYS) as [
    StaffDestinationId,
    StaffMessageKey,
  ][];
  return Object.fromEntries(entries.map(([id, key]) => [id, t(key)])) as StaffDestinationLabels;
}

/**
 * What each destination calls itself once you are on it, where that differs
 * from its label — so ⌘K finds Reports for somebody who types "how's my
 * month". Only the stable headlines; see `STAFF_DESTINATION_TITLE_KEYS`.
 */
function destinationTitlesFor(t: (key: StaffMessageKey) => string): StaffDestinationTitles {
  const entries = Object.entries(STAFF_DESTINATION_TITLE_KEYS) as [
    StaffDestinationId,
    StaffMessageKey,
  ][];
  return Object.fromEntries(entries.map(([id, key]) => [id, t(key)]));
}

export /** Every word the ⌘K palette speaks, wherever it is mounted. */
function commandPaletteCopy(t: ReturnType<typeof staffTranslator>): CommandPaletteCopy {
  return {
    language: t("shared.shopNav.language"),
    groupSession: t("shared.commandPalette.groupSession"),
    signOut: t("shared.shopNav.signOut"),
    search: t("shared.commandPalette.search"),
    dialogAriaLabel: t("shared.commandPalette.dialogAriaLabel"),
    comboboxAriaLabel: t("shared.commandPalette.comboboxAriaLabel"),
    placeholder: t("shared.commandPalette.placeholder"),
    emptyShort: t("shared.commandPalette.emptyShort"),
    emptyNoMatches: t("shared.commandPalette.emptyNoMatches"),
    searching: t("shared.commandPalette.searching"),
    searchFailed: t("shared.commandPalette.searchFailed"),
    searchUnauthorized: t("shared.commandPalette.searchUnauthorized"),
    retry: t("shared.commandPalette.retry"),
    signInAgain: t("shared.commandPalette.signInAgain"),

    groupDivers: t("shared.commandPalette.groupDivers"),
    addDiver: t("shared.commandPalette.addDiver"),
    groupTrips: t("shared.commandPalette.groupTrips"),
    groupDiveSites: t("shared.commandPalette.groupDiveSites"),
    groupCourses: t("shared.commandPalette.groupCourses"),
    groupOrders: t("shared.commandPalette.groupOrders"),
    groupGear: t("shared.commandPalette.groupGear"),
    // Every status worded here, where the translator is: `src/db`
    // returns the code (`src/i18n/gear-labels.ts` owns the words).
    gearStatuses: gearStatusLabels(t),
    groupGoTo: t("shared.commandPalette.groupGoTo"),
    groupRecent: t("shared.commandPalette.groupRecent"),
    groupToday: t("shared.commandPalette.groupToday"),
    destinationLabels: destinationLabelsFor(t),
    destinationTitles: destinationTitlesFor(t),
    goToBoarding: t("shared.commandPalette.goToBoarding"),
    goToOfflineRollCall: t("shared.commandPalette.goToOfflineRollCall"),
    hintMove: t("shared.commandPalette.hintMove"),
    hintOpen: t("shared.commandPalette.hintOpen"),
    hintClose: t("shared.commandPalette.hintClose"),
    close: t("shared.commandPalette.close"),
  };
}
