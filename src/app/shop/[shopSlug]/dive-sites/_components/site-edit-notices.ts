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
  // Issue #3706: a template pull or undo by someone who may not change the
  // site's admission fields, which both rewrite.
  "admission-managers-only": "diveSites.edit.templateUpdates.admissionManagersOnly",
  // Loop 5, row 5: the closure form's outcome, said beside that form.
  "closure-saved": "diveSites.closure.saved",
  "closure-invalid": "diveSites.closure.invalid",
};

// Only the archive action still refuses through the URL; a rejected *save*
// hands its code back to the form instead (see `SiteFormShell`), which is what
// keeps a briefing's twenty fields from being wiped by their own error banner.
export const ERROR_KEYS: Record<string, StaffMessageKey> = {
  invalid: "diveSites.edit.errorInvalid",
};
