import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";

/**
 * What each settings sub-page says back after a write.
 *
 * The hub's own `noticeMessages()` in `SettingsPage.tsx` holds every code the
 * directory can answer with — seventy of them — and a sub-page that imported it
 * would drag a 3,000-line module into its graph to read four strings. So each
 * page that moved out of the hub takes the four or five codes its own actions
 * emit, and nothing else.
 *
 * The maps stay *here* rather than in each page for the reason `team/notices.ts`
 * does: the action and the page have to agree on the spelling of a code, and one
 * file they both read is where that agreement is checkable.
 *
 * Each is built inside the request, not at module scope, so the text tracks the
 * negotiated locale rather than freezing to whichever locale first imported this
 * file.
 */
type NoticeMessages = Record<string, { tone: NoticeTone; text: string }>;

/** `/settings/boats` — `createBoatAction`, `updateBoatAction`, `deleteBoatAction`. */
export function boatNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "boat-created": { tone: "success", text: t("boats.boatCreated") },
    "boat-updated": { tone: "success", text: t("boats.boatUpdated") },
    "boat-deleted": { tone: "success", text: t("boats.boatDeleted") },
    "boat-invalid": { tone: "danger", text: t("boats.boatInvalid") },
  };
}

/** `/settings/kinds-of-day` — the three `TripLens` actions. */
export function lensNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "lens-created": { tone: "success", text: t("lenses.created") },
    "lens-updated": { tone: "success", text: t("lenses.updated") },
    "lens-deleted": { tone: "success", text: t("lenses.deleted") },
    "lens-invalid": { tone: "danger", text: t("lenses.invalid") },
  };
}

/** `/settings/seasons` — the three `SeasonEvent` actions. */
export function seasonEventNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "season-event-created": { tone: "success", text: t("seasonEvents.created") },
    "season-event-updated": { tone: "success", text: t("seasonEvents.updated") },
    "season-event-deleted": { tone: "success", text: t("seasonEvents.deleted") },
    "season-event-invalid": { tone: "danger", text: t("seasonEvents.invalid") },
  };
}

/** `/settings/dive-packages` — `createDivePackageAction`, `deleteDivePackageAction`. */
export function divePackageNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "package-saved": { tone: "success", text: t("settings.main.notice.packageSaved") },
    "package-deleted": { tone: "success", text: t("settings.main.notice.packageDeleted") },
    "package-invalid": { tone: "danger", text: t("settings.main.notice.packageInvalid") },
  };
}
