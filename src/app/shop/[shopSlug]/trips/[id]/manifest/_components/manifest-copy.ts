import type { OfflineManifestManagerCopy } from "@/components/OfflineManifestManager";
import type { listDeskEventsSince } from "@/db/desk-events";
import { catchUpSentences } from "@/i18n/desk-event-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { groupCatchUp } from "@/lib/desk-events";
import { formatTime } from "@/lib/format";

/** The emergency reference card's words — one copy for all three places it renders. */
export function emergencyReferenceCopy(t: StaffTranslator) {
  return {
    heading: t("manifest.emergency.heading"),
    empty: t("manifest.emergency.empty"),
    vesselLabel: t("manifest.emergency.vesselLabel"),
    callSignLabel: t("manifest.emergency.callSignLabel"),
    mmsiLabel: t("manifest.emergency.mmsiLabel"),
    workingChannelLabel: t("manifest.emergency.workingChannelLabel"),
    workingChannelNotRecorded: t("manifest.emergency.workingChannelNotRecorded"),
    distressChannel: t("manifest.emergency.distressChannel"),
    shoreContactLabel: t("manifest.emergency.shoreContactLabel"),
    planLabel: t("manifest.emergency.planLabel"),
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
    reconcileNoteDiscarded: t("shared.offlineManifest.reconcile.noteDiscarded"),
    reconcileNoteUnverified: t("shared.offlineManifest.reconcile.noteUnverified"),
    reconcileNoteEntry: t.raw("shared.offlineManifest.reconcile.noteEntry"),
    reconcileNoteDiverReference: t.raw("shared.offlineManifest.reconcile.noteDiverReference"),
    reconcileNoteCrewReference: t.raw("shared.offlineManifest.reconcile.noteCrewReference"),
    reconcileNoteChecklistReference: t.raw(
      "shared.offlineManifest.reconcile.noteChecklistReference",
    ),
    reconcileNoteMarkKept: t("shared.offlineManifest.reconcile.noteMarkKept"),
    reconcileNoteMarkNeedsReview: t("shared.offlineManifest.reconcile.noteMarkNeedsReview"),
    reconcileCheckpointDeparture: t("shared.rollCallCheckpoint.departure"),
    reconcileCheckpointAfterDive: t.raw("shared.rollCallCheckpoint.afterDive"),
    reconcileChecklistLocation: t("shared.offlineManifest.reconcile.checklistLocation"),
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
