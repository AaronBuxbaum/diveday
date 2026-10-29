import type { DiverTranslator } from "@/i18n/messages";

/** The words `ReadyOfflineCopy` says about the copy kept on this device. */
export function readyOfflineWords(t: DiverTranslator) {
  return {
    offlineNote: t("ready.offlineCopy"),
    savedNote: t("ready.offlineSaved"),
    remove: t("ready.offlineRemove"),
    removed: t("ready.offlineRemoved"),
    clockSaved: t("ready.offlineClockSaved", { when: "__DIVEDAY_SERVER_SAVED_AT__" }),
    clockUnknown: t("ready.offlineClockUnknown"),
    clockRollbackHeading: t("ready.offlineClockRollbackHeading"),
    clockRollbackSaved: t("ready.offlineClockRollbackSaved", {
      when: "__DIVEDAY_SERVER_SAVED_AT__",
    }),
    clockRollbackUnknown: t("ready.offlineClockRollbackUnknown"),
  };
}
