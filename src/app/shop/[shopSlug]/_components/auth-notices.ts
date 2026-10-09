import type { StaffMessageKey } from "@/i18n/staff-messages";

// These are the explanatory landings for authorization refusals elsewhere in
// the app that redirect a non-owner/manager back to Today (task 82, UX
// persona 11 "Kai") rather than teleporting silently.
export const AUTH_NOTICES: Record<string, StaffMessageKey> = {
  "waivers-not-authorized": "shopHome.notice.waiversNotAuthorized",
  "export-not-authorized": "shopHome.notice.exportNotAuthorized",
  "reports-not-authorized": "shopHome.notice.reportsNotAuthorized",
  "settings-not-authorized": "shopHome.notice.settingsNotAuthorized",
  // These four used to land on Settings, which was the nearest parent that
  // could explain them. Settings is owner/manager work now, and every one of
  // these gates is the *same* owner/manager gate — so a staffer refused there
  // is refused from Settings too, and landing them on it meant a second bounce
  // that dropped their reason on the floor. They land here instead, where the
  // reason survives.
  "team-not-authorized": "shopHome.notice.teamNotAuthorized",
  "import-not-authorized": "shopHome.notice.importNotAuthorized",
  "gear-import-not-authorized": "shopHome.notice.gearImportNotAuthorized",
  "dive-site-import-not-authorized": "shopHome.notice.diveSiteImportNotAuthorized",
  "backup-not-authorized": "shopHome.notice.backupNotAuthorized",
  "whatsapp-not-authorized": "shopHome.notice.whatsappNotAuthorized",
  "promos-not-authorized": "shopHome.notice.promosNotAuthorized",
  "integrations-not-authorized": "shopHome.notice.integrationsNotAuthorized",
  "billing-not-authorized": "shopHome.notice.billingNotAuthorized",
  "day-blowout-not-authorized": "shopHome.notice.dayBlowoutNotAuthorized",
};
