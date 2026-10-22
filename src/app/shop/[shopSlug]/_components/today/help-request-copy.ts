import type { StaffTranslator } from "@/i18n/staff-messages";
import type { HelpRequestCopy } from "./HelpRequestControl";

export function helpRequestCopy(t: StaffTranslator): HelpRequestCopy {
  return {
    complete: t("today.helpRequest.markHandled"),
    confirm: t("today.helpRequest.confirmHelper"),
    cancel: t("today.helpRequest.cancel"),
    selector: t("today.helpRequest.crewSelector"),
    speakFirst: t("today.helpRequest.speakFirst"),
    saving: t("today.helpRequest.saving"),
    assigned: t("today.helpRequest.assigned"),
    completed: t("today.helpRequest.completed"),
    undone: t("today.helpRequest.undone"),
    reopened: t("today.helpRequest.reopened"),
    stale: t("today.helpRequest.stale"),
    invalidHelper: t("today.helpRequest.invalidHelper"),
    failed: t("today.helpRequest.failed"),
    undoRefused: t("today.helpRequest.undoRefused"),
    undo: t("today.helpRequest.undo"),
    undoPending: t("today.helpRequest.undoPending"),
    dismiss: t("today.helpRequest.dismiss"),
  };
}
