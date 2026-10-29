import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";

export function initialTripStatusMessage(
  noteLossMessage: string | null,
  hasSavedTrip: boolean,
  t: OfflineManifestTranslator,
) {
  if (noteLossMessage === null || noteLossMessage.length > 0) return "";
  return t(
    hasSavedTrip
      ? "shared.offlineManifest.reconcile.ready"
      : "shared.offlineManifest.reconcile.noneForTrip",
  );
}
