import type { DiverTranslator } from "@/i18n/messages";
import {
  READY_OFFLINE_GENERATED_AT_PLACEHOLDER,
  READY_ROLLBACK_SAVED_AT_PLACEHOLDER,
} from "@/lib/ready-offline";

/** The words `ReadyOfflineCopy` says about the copy kept on this device. */
export function readyOfflineWords(t: DiverTranslator) {
  return {
    offlineNote: t("ready.offlineCopy", { when: READY_OFFLINE_GENERATED_AT_PLACEHOLDER }),
    savedNote: t("ready.offlineSaved"),
    remove: t("ready.offlineRemove"),
    removed: t("ready.offlineRemoved"),
    removeFailed: t("ready.offlineRemoveFailed"),
    clockRollbackHeading: t("ready.offlineClockRollbackHeading"),
    clockRollbackSaved: t("ready.offlineClockRollbackSaved", {
      when: READY_ROLLBACK_SAVED_AT_PLACEHOLDER,
    }),
    clockRollbackUnknown: t("ready.offlineClockRollbackUnknown"),
  };
}
