"use client";
import { useEffect, useMemo, useState } from "react";
import { watchRollCallTouches } from "@/components/roll-call-touch-guard";
import type { OfflineTripControls } from "./offline-manifest/controls";
import { OfflineManifestList } from "./offline-manifest/ManifestList";
import { offlineRecorders } from "./offline-manifest/recorders";
import { OfflineNoSavedTrip, OfflineOpeningScreen } from "./offline-manifest/ShellScreens";
import { DiscardedRecordsNotice, translatorForThisDevice } from "./offline-manifest/shared";
import { OfflineTripScreen } from "./offline-manifest/TripScreen";
import { offlineTripView } from "./offline-manifest/trip-view";
import { useSavedManifest } from "./offline-manifest/use-saved-manifest";

export function OfflineManifestView() {
  // A palm or spray on the glass is not a mark (roll-call-touch-guard).
  useEffect(() => watchRollCallTouches(), []);
  // Memoized so `reconcile`/`reconcileList` below (and the effect that reruns
  // whenever they change) stay referentially stable across renders — the
  // device's language doesn't change mid-session, so recreating the
  // translator on every render bought nothing except spurious effect reruns.
  const { t, locale } = useMemo(() => translatorForThisDevice(), []);
  const shellVersionCopy = useMemo(
    () => ({
      staleBanner: t("shared.offlineManifest.shellVersion.staleBanner"),
      updateBanner: t("shared.offlineManifest.shellVersion.updateBanner"),
      refreshButton: t("shared.offlineManifest.shellVersion.refreshButton"),
    }),
    [t],
  );
  const {
    tripId,
    envelope,
    removedForOtherShop,
    dispatchSaved,
    list,
    checkpoint,
    setCheckpoint,
    message,
    setMessage,
    storeRead,
    discarded,
    acknowledgeDiscarded,
    reconcile,
  } = useSavedManifest(t);
  // A marker for the tools that photograph this page (`scripts/screenshot.mjs`,
  // issue #2235): set on the document once the store has been read, so a
  // capture waits for the real branch rather than the "Opening…" one.
  // It changes nothing anyone sees.
  useEffect(() => {
    if (!storeRead) return;
    document.documentElement.dataset.offlineSettled = "";
    return () => {
      delete document.documentElement.dataset.offlineSettled;
    };
  }, [storeRead]);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [busyChecklistItem, setBusyChecklistItem] = useState<string | null>(null);
  // Its own busy key, like the checklist's: a counter tap must never appear to
  // disable a diver's roll-call row, and vice versa.
  const [busyArrival, setBusyArrival] = useState<string | null>(null);
  /**
   * What the crew is typing about a person who is unaccounted for, keyed by the
   * booking or person id the row is about (ADR
   * 20260828-a-missing-diver-gets-a-sentence). It rides the next result queued
   * for that subject and is cleared with it.
   *
   * Ordinary component state, deliberately: the deleted apparatus mirrored a
   * draft into IndexedDB and cleared it on sync, which is a second store to
   * keep honest for a box that lives one tap away from the submit that empties
   * it. Losing an unsent sentence to a reload is the same loss as losing an
   * unsent one on the live manifest, and the live manifest does not mirror
   * either.
   */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const discardNotice = (
    <DiscardedRecordsNotice t={t} records={discarded} onAcknowledge={acknowledgeDiscarded} />
  );

  // Before the store has been read — which includes every server render, since
  // the effect above only runs in the browser — say what is actually true and
  // nothing more. See `storeRead` above for why this branch sits ahead of the
  // `tripId` split rather than inside either side of it: it must not depend on
  // the URL, because the cached shell is one document replayed for all of them.
  if (!storeRead) {
    return <OfflineOpeningScreen t={t} message={message} />;
  }

  if (!tripId) {
    return (
      <OfflineManifestList
        t={t}
        shellVersionCopy={shellVersionCopy}
        list={list}
        message={message}
        discardNotice={discardNotice}
      />
    );
  }

  // `envelope` is null for two different reasons and this branch covers both,
  // because `savedCopyReducer` makes them the same state: nothing has been
  // loaded, or the store said this trip's copy is gone. The second cannot be
  // undone by a read that was already in flight (see the reducer), so there is
  // no ordering in which a roster reaches the screen after its record has been
  // deleted — including for a single commit.
  if (!envelope) {
    return (
      <OfflineNoSavedTrip
        t={t}
        message={message}
        removedForOtherShop={removedForOtherShop}
        discardNotice={discardNotice}
      />
    );
  }

  const view = offlineTripView(envelope, checkpoint);
  if (!view) return null;
  const { record, recordChecklistCheck, recordArrival } = offlineRecorders({
    t,
    tripId,
    envelope,
    checkpoint,
    expired: view.expired,
    noteDrafts,
    setNoteDrafts,
    setBusyBooking,
    setBusyChecklistItem,
    setBusyArrival,
    dispatchSaved,
    setMessage,
    reconcile,
  });

  const controls: OfflineTripControls = {
    t,
    locale,
    message,
    setCheckpoint,
    busyBooking,
    busyChecklistItem,
    busyArrival,
    noteDrafts,
    setNoteDrafts,
    record,
    recordChecklistCheck,
    recordArrival,
  };
  return (
    <OfflineTripScreen
      view={view}
      controls={controls}
      tripId={tripId}
      shellVersionCopy={shellVersionCopy}
      discardNotice={discardNotice}
      reconcile={reconcile}
    />
  );
}
