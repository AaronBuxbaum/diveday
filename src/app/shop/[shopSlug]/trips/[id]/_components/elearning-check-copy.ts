import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ElearningCheckCopy } from "./ElearningCheck";

/** The eLearning check's words, translated on the server (H-106). */
export function elearningCheckCopy(t: StaffTranslator): ElearningCheckCopy {
  return {
    check: t("trips.roster.elearningCheck.check"),
    checking: t("trips.roster.elearningCheck.checking"),
    complete: t("trips.roster.elearningCheck.complete"),
    notComplete: t("trips.roster.elearningCheck.notComplete"),
    noRecord: t("trips.roster.elearningCheck.noRecord"),
    unreadable: t("trips.roster.elearningCheck.unreadable"),
    failed: t("trips.roster.elearningCheck.failed"),
    undo: t("shared.undoToast.undo"),
    undoPending: t("shared.undoToast.pendingLabel"),
  };
}
