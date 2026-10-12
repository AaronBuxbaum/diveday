import type { PushOptInCopy } from "@/components/PushOptIn";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The manifest's "tell this phone" words, resolved on the server for `PushOptIn`. */
export function pushOptInCopy(t: StaffTranslator): PushOptInCopy {
  return {
    heading: t("trips.offlineManifestManager.pushHeading"),
    body: t("trips.offlineManifestManager.pushBody"),
    enable: t("trips.offlineManifestManager.pushEnable"),
    enabling: t("trips.offlineManifestManager.pushEnabling"),
    disable: t("trips.offlineManifestManager.pushDisable"),
    on: t("trips.offlineManifestManager.pushOn"),
    unsupported: t("trips.offlineManifestManager.pushUnsupported"),
    homeScreenHint: t("trips.offlineManifestManager.pushHomeScreenHint"),
    denied: t("trips.offlineManifestManager.pushDenied"),
    error: t("trips.offlineManifestManager.pushError"),
  };
}
