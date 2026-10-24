import type { DiverTranslator } from "@/i18n/messages";

/** The words `ReadyOfflineCopy` says about the copy kept on this device. */
export function readyOfflineWords(t: DiverTranslator) {
  return {
    offlineNote: t("ready.offlineCopy"),
    savedNote: t("ready.offlineSaved"),
    remove: t("ready.offlineRemove"),
    removed: t("ready.offlineRemoved"),
  };
}
