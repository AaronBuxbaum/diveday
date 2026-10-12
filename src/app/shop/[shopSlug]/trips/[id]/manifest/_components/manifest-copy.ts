import type { OfflineManifestManagerCopy } from "@/components/OfflineManifestManager";
import type { PushOptInCopy } from "@/components/PushOptIn";
import type { listDeskEventsSince } from "@/db/desk-events";
import type { latestTripStage } from "@/db/trip-stages";
import { catchUpSentences } from "@/i18n/desk-event-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { groupCatchUp } from "@/lib/desk-events";
import { formatTime } from "@/lib/format";
import { STAGE_TAP_KEYS, TRIP_STAGES } from "@/lib/trip-stages";

/** The emergency reference card's words — one copy for all three places it renders. */
export function emergencyReferenceCopy(t: StaffTranslator) {
  return {
    heading: t("manifest.emergency.heading"),
    empty: t("manifest.emergency.empty"),
    vesselLabel: t("manifest.emergency.vesselLabel"),
    shoreContactLabel: t("manifest.emergency.shoreContactLabel"),
    planLabel: t("manifest.emergency.planLabel"),
  };
}

/** The stage strip's words, with who tapped the current stage and when. */
export function stageStripCopy(
  t: StaffTranslator,
  stage: Awaited<ReturnType<typeof latestTripStage>>,
  locale: string,
  timeZone: string,
) {
  return {
    legend: t("manifest.stage.legend"),
    errorRefusal: t("manifest.stage.errorRefusal"),
    taps: TRIP_STAGES.map((value) => ({
      stage: value,
      label: t(STAGE_TAP_KEYS[value]),
    })),
    recordedLine: stage
      ? t("manifest.stage.recordedLine", {
          name: stage.recordedByName ?? "",
          time: formatTime(stage.recordedAt, locale, timeZone),
        })
      : undefined,
  };
}

/** The offline copy's words: its states, its freshness and its reconcile lines. */
export function offlineManifestManagerCopy(t: StaffTranslator): OfflineManifestManagerCopy {
  return {
    checkingDevice: t("trips.offlineManifestManager.checkingDevice"),
    reconcileRejectedOne: t("trips.offlineManifestManager.reconcileRejectedOne"),
    reconcileRejectedOther: t.raw("trips.offlineManifestManager.reconcileRejectedOther"),
    reconcilePendingOne: t("trips.offlineManifestManager.reconcilePendingOne"),
    reconcilePendingOther: t.raw("trips.offlineManifestManager.reconcilePendingOther"),
    reconcileCaughtUp: t("trips.offlineManifestManager.reconcileCaughtUp"),
    reconcileErrorFallback: t("trips.offlineManifestManager.reconcileErrorFallback"),
    savingMessage: t("trips.offlineManifestManager.savingMessage"),
    saveErrorFallback: t("trips.offlineManifestManager.saveErrorFallback"),
    offlineWithSavedCopy: t("trips.offlineManifestManager.offlineWithSavedCopy"),
    offlineNoSavedCopy: t("trips.offlineManifestManager.offlineNoSavedCopy"),
    refreshNoSignal: t("trips.offlineManifestManager.refreshNoSignal"),
    heading: t("trips.offlineManifestManager.heading"),
    body: t("trips.offlineManifestManager.body"),
    connectivityOfflineWithCopy: t("trips.offlineManifestManager.connectivityOfflineWithCopy"),
    connectivityOffline: t("trips.offlineManifestManager.connectivityOffline"),
    connectivityOnline: t("trips.offlineManifestManager.connectivityOnline"),
    connectivityOnlineTitle: t("trips.offlineManifestManager.connectivityOnlineTitle"),
    connectivityOfflineTitle: t("trips.offlineManifestManager.connectivityOfflineTitle"),
    freshnessCurrent: t("trips.offlineManifestManager.freshnessCurrent"),
    freshnessAging: t("trips.offlineManifestManager.freshnessAging"),
    freshnessStale: t("trips.offlineManifestManager.freshnessStale"),
    savedSummary: t.raw("trips.offlineManifestManager.savedSummary"),
    refreshingLabel: t("trips.offlineManifestManager.refreshingLabel"),
    refreshNowLabel: t("trips.offlineManifestManager.refreshNowLabel"),
    openOfflineRollCall: t("trips.offlineManifestManager.openOfflineRollCall"),
    groupHeading: t("manifest.onThisPhone"),
  };
}

/** The push opt-in's words, inside the device group. */
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

/**
 * The catch-up strip's words, or nothing for somebody who has never worked
 * this departure — there is nothing for a catch-up to be "since".
 */
export function catchUpStripView(
  catchUp: Awaited<ReturnType<typeof listDeskEventsSince>>,
  locale: string,
  timeZone: string,
  t: StaffTranslator,
) {
  if (!catchUp.mark) return null;
  return {
    label: t("manifest.catchUp.label", {
      time: formatTime(catchUp.mark.at, locale, timeZone),
    }),
    // One sentence per kind of desk act, in `DESK_EVENT_KINDS` order rather
    // than the order the desk happened to work. Composed here because the
    // names are joined by `Intl.ListFormat` in the reader's own locale.
    sentences: catchUpSentences(t, locale, groupCatchUp(catchUp.events)),
    dismissLabel: t("manifest.catchUp.dismiss"),
  };
}
