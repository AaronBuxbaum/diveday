"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { watchRollCallTouches } from "@/components/roll-call-touch-guard";
import { pendingOfflineEventCount } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./offline-manifest/controls";
import { OfflineManifestList } from "./offline-manifest/ManifestList";
import { offlineRecorders } from "./offline-manifest/recorders";
import {
  OfflineManifestSkeleton,
  OfflineNoSavedTrip,
  OfflineOpeningScreen,
  OfflineTenantVerificationScreen,
} from "./offline-manifest/ShellScreens";
import { DiscardedRecordsNotice, translatorForThisDevice } from "./offline-manifest/shared";
import { OfflineTripScreen } from "./offline-manifest/TripScreen";
import { liveManifestHref, offlineTripView } from "./offline-manifest/trip-view";
import { useLiveAnswering } from "./offline-manifest/use-live-return";
import { useSavedManifest } from "./offline-manifest/use-saved-manifest";

const subscribeNever = () => () => {};

/**
 * **Words only once the device's language is known.** The words on this page
 * come from `navigator.language`, which the server does not have: it rendered
 * the default language, and a phone set to Spanish then hydrated Spanish over
 * English text, a hydration mismatch React answers by throwing the server's
 * markup away (#418). So the server and the hydrating render both draw the
 * wordless skeleton, and the screen with words mounts on the render right
 * after hydration, with the device's language from its first render on. One
 * mount, one translator: the store read below never runs in one language and
 * then again in another.
 */
export function OfflineManifestView() {
  const onThisDevice = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return onThisDevice ? <OfflineManifestScreen /> : <OfflineManifestSkeleton />;
}

function OfflineManifestScreen() {
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
    verifiedTenantSlug,
    foreignPendingChanges,
    tripNoteLossMessage,
    tenantChangePending,
    removedForOtherShop,
    dispatchSaved,
    list,
    checkpoint,
    setCheckpoint,
    message,
    setMessage,
    storeRead,
    storeReadFailed,
    discarded,
    acknowledgeDiscarded,
    reconcile,
    fallback,
    servedWithoutAnswer,
    copyCaveat,
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
  const visibleDiscarded = verifiedTenantSlug
    ? discarded.filter((record) => record.shopSlug === verifiedTenantSlug)
    : discarded;
  const discardNotice = (
    <DiscardedRecordsNotice t={t} records={visibleDiscarded} onAcknowledge={acknowledgeDiscarded} />
  );
  // Sent here because DiveDay did not answer: keep asking the live manifest,
  // and offer it once it answers in time. Never a swap: the captain chooses
  // when to leave a count (re-review R1).
  const liveHref =
    servedWithoutAnswer && envelope && tripId
      ? liveManifestHref(envelope, tripId, checkpoint)
      : null;
  const liveAnswering = useLiveAnswering(liveHref);

  // Before the store has been read, say what is actually true and nothing
  // more. See `storeRead` above for why this branch sits ahead of the
  // `tripId` split rather than inside either side of it: it must not depend on
  // the URL, because the cached shell is one document replayed for all of them.
  if (!storeRead) {
    return <OfflineOpeningScreen t={t} message={message} />;
  }

  if (tenantChangePending) {
    // Other in-flight reads can settle with ordinary "ready" copy after the
    // 409. The quarantine status must remain authoritative until verification.
    return (
      <OfflineTenantVerificationScreen
        t={t}
        message={t("shared.offlineManifest.reconcile.tenantChanged")}
      />
    );
  }

  if (!tripId) {
    const visibleList =
      list && verifiedTenantSlug
        ? list.filter((saved) => saved.snapshot.shop.slug === verifiedTenantSlug)
        : list;
    return (
      <OfflineManifestList
        t={t}
        shellVersionCopy={shellVersionCopy}
        list={visibleList}
        message={message}
        foreignPendingChanges={foreignPendingChanges}
        discardNotice={discardNotice}
        readFailed={storeReadFailed}
        fallback={fallback}
      />
    );
  }

  // `envelope` is null for two different reasons and this branch covers both,
  // because `savedCopyReducer` makes them the same state: nothing has been
  // loaded, or the store said this trip's copy is gone. The second cannot be
  // undone by a read that was already in flight (see the reducer), so there is
  // no ordering in which a roster reaches the screen after its record has been
  // deleted — including for a single commit.
  const foreignTrip =
    verifiedTenantSlug !== null &&
    envelope !== null &&
    envelope.snapshot.shop.slug !== verifiedTenantSlug;
  if (!envelope || foreignTrip) {
    return (
      <OfflineNoSavedTrip
        t={t}
        message={message}
        removedForOtherShop={foreignTrip || removedForOtherShop}
        readFailed={storeReadFailed}
        foreignPendingChanges={foreignPendingChanges}
        discardNotice={foreignTrip ? null : discardNotice}
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
    servedWithoutAnswer,
    copyCaveat,
    // Offered only with nothing waiting to send: on the live list a mark still
    // queued here shows only as "still sending", and its diver looks uncounted.
    liveOffer:
      liveAnswering && liveHref && pendingOfflineEventCount(envelope) === 0 ? liveHref : null,
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
      foreignPendingChanges={foreignPendingChanges}
      noteLossMessage={tripNoteLossMessage}
      shellVersionCopy={shellVersionCopy}
      discardNotice={discardNotice}
      reconcile={reconcile}
    />
  );
}
