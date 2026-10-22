import type { StaffMessageKey } from "@/i18n/staff-messages";

// A notice/error query param maps to a message key, never to a sentence — the
// words come from the staff bundle at render time (docs ADR
// 20260730-staff-copy-localization).
export const NOTICE_KEYS: Record<string, StaffMessageKey> = {
  saved: "diveSites.edit.savedNotice",
  copied: "diveSites.edit.copiedNotice",
  "template-updated": "diveSites.edit.templateUpdates.updated",
  "template-replaced": "diveSites.edit.templateUpdates.replaced",
  "template-undone": "diveSites.edit.templateUpdates.undone",
  "template-update-unavailable": "diveSites.edit.templateUpdates.unavailable",
};

// Only the archive action still refuses through the URL; a rejected *save*
// hands its code back to the form instead (see `SiteFormShell`), which is what
// keeps a briefing's twenty fields from being wiped by their own error banner.
export const ERROR_KEYS: Record<string, StaffMessageKey> = {
  invalid: "diveSites.edit.errorInvalid",
};
