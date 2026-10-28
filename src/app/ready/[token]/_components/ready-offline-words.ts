import type { DiverTranslator } from "@/i18n/messages";
import { READY_OFFLINE_SAVED_AT_PLACEHOLDER } from "@/lib/ready-offline";

/** The words `ReadyOfflineCopy` says about the copy kept on this device. */
export function readyOfflineWords(t: DiverTranslator) {
  return {
    offlineNote: t("ready.offlineCopy", { when: READY_OFFLINE_SAVED_AT_PLACEHOLDER }),
    savedNote: t("ready.offlineSaved"),
    remove: t("ready.offlineRemove"),
    removed: t("ready.offlineRemoved"),
  };
}
