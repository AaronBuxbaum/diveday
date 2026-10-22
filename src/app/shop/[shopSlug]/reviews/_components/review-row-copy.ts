import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ReviewRowCopy } from "./ReviewRowActions";

/**
 * The words every row's action bar reports with, translated once for the
 * whole page rather than per row — a staff client component cannot
 * translate, so it takes them as props (ADR 20260730-staff-copy-localization).
 */
export function reviewRowCopy(t: StaffTranslator): ReviewRowCopy {
  return {
    publish: t("reviews.publish"),
    republish: t("reviews.republish"),
    saving: t("reviews.saving"),
    hide: t("reviews.hide"),
    hideConfirm: t("reviews.hideConfirm"),
    hideReasonLabel: t("reviews.hideReasonLabel"),
    hideReasonPlaceholder: t("reviews.hideReasonPlaceholder"),
    hideNoteLabel: t("reviews.hideNoteLabel"),
    markStandout: t("reviews.markStandout"),
    removeStandout: t("reviews.removeStandout"),
    hiddenToast: t("reviews.notice.hiddenToast"),
    undo: t("shared.undoToast.undo"),
    undoPending: t("shared.undoToast.pendingLabel"),
    dismiss: t("shared.undoToast.dismiss"),
    published: t("reviews.notice.published"),
    standout: t("reviews.notice.standout"),
    standoutRemoved: t("reviews.notice.standoutRemoved"),
    reasonRequired: t("reviews.notice.reasonRequired"),
    noteRequired: t("reviews.notice.noteRequired"),
    noteTooLong: t("reviews.notice.noteTooLong"),
    error: t("reviews.notice.error"),
  };
}
