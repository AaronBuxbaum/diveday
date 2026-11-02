import { ownerOrManagerWords, type StaffWords } from "@/i18n/shared-sentences";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { TodayRefusalNotice } from "@/lib/staff-notices";

// The words for every `TodayRefusalNotice` (`src/lib/staff-notices.ts`), in
// `shared.refusal.*`: a code with no entry here is a compile error. These are the explanatory landings for authorization refusals elsewhere in
// the app that redirect a non-owner/manager back to Today (task 82, UX
// persona 11 "Kai") rather than teleporting silently.
export const AUTH_NOTICES: Record<TodayRefusalNotice, StaffMessageKey | StaffWords> = {
  "waivers-not-authorized": "shared.refusal.waiversNotAuthorized",
  "export-not-authorized": "shared.refusal.exportNotAuthorized",
  "reports-not-authorized": "shared.refusal.reportsNotAuthorized",
  "settings-not-authorized": "shared.refusal.settingsNotAuthorized",
  // These four used to land on Settings, which was the nearest parent that
  // could explain them. Settings is owner/manager work now, and every one of
  // these gates is the *same* owner/manager gate — so a staffer refused there
  // is refused from Settings too, and landing them on it meant a second bounce
  // that dropped their reason on the floor. They land here instead, where the
  // reason survives.
  "team-not-authorized": "shared.refusal.teamNotAuthorized",
  "import-not-authorized": "shared.refusal.importNotAuthorized",
  "gear-import-not-authorized": "shared.refusal.gearImportNotAuthorized",
  "dive-site-import-not-authorized": "shared.refusal.diveSiteImportNotAuthorized",
  "backup-not-authorized": ownerOrManagerWords("backup"),
  "whatsapp-not-authorized": ownerOrManagerWords("whatsapp"),
  "promos-not-authorized": "shared.refusal.promosNotAuthorized",
  "integrations-not-authorized": ownerOrManagerWords("integrations"),
  "billing-not-authorized": "shared.refusal.billingNotAuthorized",
  "day-blowout-not-authorized": "shared.refusal.dayBlowoutNotAuthorized",
  "activity-not-authorized": "shared.refusal.activityNotAuthorized",
};
