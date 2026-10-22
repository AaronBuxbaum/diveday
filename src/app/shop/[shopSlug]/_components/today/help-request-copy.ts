import type { StaffTranslator } from "@/i18n/staff-messages";
import type { HelpRequestCopy } from "./HelpRequestControl";

export function helpRequestCopy(t: StaffTranslator): HelpRequestCopy {
  return {
    arrange: t("today.helpRequest.arrangeHelp"),
    change: t("today.helpRequest.changeHelper"),
    complete: t("today.helpRequest.markHandled"),
    confirm: t("today.helpRequest.confirmHelper"),
    cancel: t("today.helpRequest.cancel"),
    selector: t("today.helpRequest.crewSelector"),
    speakFirst: t("today.helpRequest.speakFirst"),
    meeting: t("today.helpRequest.meeting"),
    saving: t("today.helpRequest.saving"),
    assigned: t("today.helpRequest.assigned"),
    completed: t("today.helpRequest.completed"),
    undone: t("today.helpRequest.undone"),
    stale: t("today.helpRequest.stale"),
    invalidHelper: t("today.helpRequest.invalidHelper"),
    failed: t("today.helpRequest.failed"),
    undo: t("today.helpRequest.undo"),
    undoPending: t("today.helpRequest.undoPending"),
    dismiss: t("today.helpRequest.dismiss"),
  };
}
