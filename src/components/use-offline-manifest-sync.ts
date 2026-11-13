"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  hasManifestRereadOwner,
  invalidateManifestRead,
  requestManifestReread,
} from "@/components/manifest-stale-generation";
import { fill, pluralForm } from "@/i18n/fill";
import { requestBackgroundFlush } from "@/lib/background-flush";
import {
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  primeOfflineManifestShell,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  claimOfflineManifestSnapshot,
  fetchOfflineManifestShopSlug,
  OFFLINE_MANIFEST_STALE_READ,
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  pendingOfflineEventCount,
  rejectedOfflineEventCount,
} from "@/lib/offline-manifests";
import { useOfflineManifestSaved } from "./use-offline-manifest-saved";

// Fallback only — see ADR 20260726-manifest-push-refresh. The SSE
// subscription below is the primary trigger; this interval (plus
// reconnect/visibility triggers) is what still runs when SSE never connects
// or a boat's signal drops, which push alone can never cover.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

/** The reads (`trip:epoch:revision`) this tab already saved as an offline copy. */
const savedReads = new Set<string>();

/** Forget which reads this tab saved (a test starting clean). */
export function forgetSavedOfflineReads() {
  savedReads.clear();
}

function noteDispositionCount(
  envelope: OfflineManifestEnvelope | null | undefined,
  disposition: "discarded_erasure_cutoff" | "discarded_unverified_snapshot",
) {
  return envelope
    ? [...envelope.events, ...envelope.checklistEvents].filter(
        (event) => event.noteDisposition === disposition,
      ).length
    : 0;
}

/** The words the save, sync and reconcile narration uses, resolved server-side. */
export interface OfflineManifestSyncCopy {
  checkingDevice: string;
  reconcilePendingOne: string;
  /** `{count}` placeholder. */
  reconcilePendingOther: string;
  reconcileCaughtUp: string;
  reconcileErrorFallback: string;
  savingMessage: string;
  saveErrorFallback: string;
  offlineWithSavedCopy: string;
  offlineNoSavedCopy: string;
  refreshNoSignal: string;
}

function recordReload(
  envelope: OfflineManifestEnvelope | null,
  counters: {
    pending: { current: number };
    rejected: { current: number };
    cutoff: { current: number };
    unverified: { current: number };
  },
  copy: OfflineManifestSyncCopy,
  setMessage: React.Dispatch<React.SetStateAction<string>>,
  refresh: () => void,
  externalSync: boolean,
) {
  const pending = envelope ? pendingOfflineEventCount(envelope) : 0;
  const before = counters.pending.current;
  counters.pending.current = pending;
  counters.rejected.current = envelope ? rejectedOfflineEventCount(envelope) : 0;
  counters.cutoff.current = noteDispositionCount(envelope, "discarded_erasure_cutoff");
  counters.unverified.current = noteDispositionCount(envelope, "discarded_unverified_snapshot");
  if (!navigator.onLine) setMessage(envelope ? copy.offlineWithSavedCopy : copy.offlineNoSavedCopy);
  if (pending > 0) setMessage((current) => (current === copy.reconcileCaughtUp ? "" : current));
  if (envelope && navigator.onLine && (externalSync || (before > 0 && pending === 0))) refresh();
}

function useSavedAndCounters(
  tripId: string,
  copy: OfflineManifestSyncCopy,
  setMessage: React.Dispatch<React.SetStateAction<string>>,
  refresh: () => void,
) {
  const counters = useRef({
    pending: { current: 0 },
    rejected: { current: 0 },
    cutoff: { current: 0 },
    unverified: { current: 0 },
  }).current;
  const state = useOfflineManifestSaved(tripId, (envelope, externalSync) =>
    recordReload(envelope, counters, copy, setMessage, refresh, externalSync),
  );
  return { ...state, counters };
}

/**
 * Everything the "On this phone" card does to the device's offline copy: the
 * save, the pending-event reconcile, and the four refresh triggers (interval,
 * reconnect or visibility, the manifest push stream, the service worker's
 * message). The component keeps the render.
 */
export function useOfflineManifestSync(
  payload: OfflineManifestPayload,
  copy: OfflineManifestSyncCopy,
) {
  const router = useRouter();
  const tripId = payload.manifests[0]?.trip.id ?? "";
  const [message, setMessage] = useState(copy.checkingDevice);
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState(false);
  // saveOfflineManifest/syncOfflineManifest overlap easily across the mount
  // effect, the reconnect listener, and the interval — this keeps them from
  // racing each other into IndexedDB. Cross-tab/cross-view races (this page
  // vs. the offline viewer appending a roll-call event) are handled inside
  // the store itself (see withManifestLock in offline-manifest-store.ts).
  const inFlight = useRef<Promise<void> | null>(null);
  // Read via ref inside `save` (below) instead of closing over `payload`
  // directly, so `save`'s identity — and the timer effect that depends on
  // it — stays stable across a server re-render (e.g. a roll-call action's
  // revalidatePath), rather than resetting the 5-minute interval on every
  // edit made on this trip.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  // Tracks the pending/rejected counts as of the *last* reconcile, so a
  // reconcile only narrates/refreshes when something actually changed this
  // round. Neither pending nor rejected events are ever removed from the
  // envelope, so "there's a pending event" or "there's a rejected event"
  // would otherwise stay true forever after the first one — every background
  // reconcile would then call router.refresh() unconditionally, whose fresh
  // payload re-triggers the effect below, which reconciles again: an
  // unbounded loop. Comparing against the last-seen counts catches only a
  // genuine transition (something newly resolved, or newly rejected).
  const { saved, setSaved, savedRevision, counters } = useSavedAndCounters(
    tripId,
    copy,
    setMessage,
    () => router.refresh(),
  );
  // Set right before a manual "Refresh now" (or router.refresh() call below)
  // whose resulting save should show the loud confirmation instead of
  // passing silently, since the save itself only happens once the refreshed
  // payload actually lands as a prop (see the payload effect).
  const manualRefreshPending = useRef(false);
  // Set when a stale claim asked for one re-read of the page (issue #4391), so
  // a second stale claim in a row does not ask again.
  const staleReread = useRef(false);

  const runReconcileOnce = useCallback(async () => {
    if (!tripId) return;
    const savedAtStart = savedRevision.current;
    // Offline, or a reconcile that could not reach the server: hand the flush
    // to Background Sync so it happens when signal returns *even if this page
    // is gone by then* (ADR 20260804-manifest-web-push). Without this, roll
    // call recorded at sea waits for somebody to reopen DiveDay — and those
    // events are the record of who came back aboard.
    //
    // Never awaited: `requestBackgroundFlush` waits on
    // `navigator.serviceWorker.ready`, which never settles on a device with no
    // worker registered, and awaiting it here would hold the reconcile queue
    // below — every later pass on this page — behind a promise that never ends.
    if (!navigator.onLine) {
      void requestBackgroundFlush();
      return;
    }
    const pendingBefore = counters.pending.current;
    const rejectedBefore = counters.rejected.current;
    const cutoffNotesBefore = counters.cutoff.current;
    const unverifiedNotesBefore = counters.unverified.current;
    try {
      const tenantRound = await beginOfflineTenantVerificationRound();
      const expectedShopSlug = payloadRef.current.shop.slug;
      const verifiedShopSlug = await fetchOfflineManifestShopSlug();
      if (verifiedShopSlug !== expectedShopSlug) {
        setMessage(copy.reconcileErrorFallback);
        return;
      }
      const envelope = await syncOfflineManifest(tripId, expectedShopSlug, tenantRound);
      if (envelope) {
        if (!setSaved(envelope, savedAtStart)) {
          if (pendingBefore > 0) router.refresh();
          return;
        }
        const rejected = rejectedOfflineEventCount(envelope);
        const pending = pendingOfflineEventCount(envelope);
        const cutoffNotes = noteDispositionCount(envelope, "discarded_erasure_cutoff");
        const unverifiedNotes = noteDispositionCount(envelope, "discarded_unverified_snapshot");
        const noteWasDiscarded =
          cutoffNotes > cutoffNotesBefore || unverifiedNotes > unverifiedNotesBefore;
        counters.pending.current = pending;
        counters.rejected.current = rejected;
        counters.cutoff.current = cutoffNotes;
        counters.unverified.current = unverifiedNotes;
        // Only narrate/refresh the live page on a genuine transition this
        // round (something was pending before, or a new rejection landed) —
        // a snapshot with only long-resolved events stays silent forever.
        if (pendingBefore > 0 || rejected > rejectedBefore || noteWasDiscarded) {
          // Rejections are deliberately *not* narrated here any more: they get
          // the pinned danger notice below instead, because a tap that never
          // entered the safety trail must not be a line in a card at the foot
          // of the page. This region keeps the states that belong to the card
          // — still sending, and caught up.
          setMessage(
            pending > 0
              ? fill(
                  pluralForm(pending, {
                    one: copy.reconcilePendingOne,
                    other: copy.reconcilePendingOther,
                  }),
                  { count: pending },
                )
              : rejected > 0
                ? ""
                : copy.reconcileCaughtUp,
          );
          router.refresh();
        }
      }
    } catch {
      // syncOfflineManifest throws a typed OfflineManifestError, not an
      // English sentence (src/lib/offline-manifest-store.ts) — the only
      // failure mode here is "couldn't reach the server," which the one
      // fallback string already says. That includes a sync that gave up at
      // its deadline (`SYNC_TIMEOUT_MS`): the events are still pending on the
      // device, and the next pass sends them again under the same ids.
      setMessage(copy.reconcileErrorFallback);
      // Same reasoning as the offline branch above: a failed flush is exactly
      // what Background Sync is for, and this page may not be here to retry.
      // Not awaited, for the same reason as above.
      void requestBackgroundFlush();
    }
  }, [router, tripId, copy, setSaved, savedRevision, counters]);

  // A reconciling device applying a backlog of offline events publishes one
  // push signal per event (recordRollCall), and this same device is normally
  // subscribed to its own trip's stream — so a genuine multi-event
  // reconnect can otherwise trigger a burst of concurrent syncOfflineManifest
  // calls, each resubmitting the same still-pending batch before the first
  // one's response has even landed (syncOfflineManifest only resolves the
  // pending IndexedDB records once its own response arrives). Serializing
  // through the same in-flight/queued pattern `save` already uses below
  // turns that burst into at most one more pass after the current one
  // finishes, instead of N overlapping requests.
  const reconcileInFlight = useRef<Promise<void> | null>(null);
  const reconcileQueued = useRef(false);

  const reconcile = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    if (reconcileInFlight.current) {
      reconcileQueued.current = true;
      return reconcileInFlight.current;
    }
    const run = (async () => {
      let again = true;
      while (again) {
        await runReconcileOnce();
        again = reconcileQueued.current;
        reconcileQueued.current = false;
      }
    })();
    reconcileInFlight.current = run;
    try {
      await run;
    } finally {
      reconcileInFlight.current = null;
    }
  }, [tripId, runReconcileOnce]);

  // A follow-up request that arrives while a save is already writing gets
  // coalesced here instead of dropped — otherwise a save already in flight
  // when a fresher payload lands (or a manual click arrives mid-background-
  // save) would either persist stale data under a "fresh" timestamp, or (for
  // a manual request) never run its own busy/message handling at all, since
  // joining someone else's in-flight promise skips it entirely.
  const queuedSave = useRef<{ silent: boolean } | null>(null);

  const runSaveOnce = useCallback(
    async (opts: { silent: boolean }) => {
      const savedAtStart = savedRevision.current;
      if (!opts.silent) {
        setBusy(true);
        setMessage(copy.savingMessage);
      }
      try {
        await primeOfflineManifestShell();
        const currentPayload = payloadRef.current;
        let tenantRound: number | undefined;
        if (navigator.onLine) {
          tenantRound = await beginOfflineTenantVerificationRound();
          const verifiedShop = await fetchOfflineManifestShopSlug();
          if (verifiedShop !== currentPayload.shop.slug) {
            throw new Error(copy.saveErrorFallback);
          }
        } else {
          const existing = await loadOfflineManifest(tripId);
          if (!existing || existing.snapshot.shop.slug !== currentPayload.shop.slug) {
            throw new Error(copy.saveErrorFallback);
          }
          setSaved(existing, savedAtStart);
          return;
        }
        // The page issues no snapshot (issue #4391): trade the epoch and
        // revision its rows were read at for one now. An erasure or another
        // copy since then means those rows are older than the server holds
        // (they may name an erased diver or miss a newly seated one), so they
        // are not saved; the re-read page lands as a new payload and is saved
        // by the effect below.
        // Rows this device already saved from this very read are not claimed
        // twice: the first claim moved the trip's revision, so a second one for
        // the same read always reads as superseded, and the re-read that
        // follows would refetch the page on every back or forward. Nothing is
        // written here, so an erasure that purged the copy since still gets
        // its fence below: no copy on the device, no skip.
        // An erasure since the first save reaches the device through the next
        // refresh trigger (push, interval, reconnect), a new read, not through
        // a back or forward.
        const readKey = currentPayload.readAt
          ? `${tripId}:${currentPayload.readAt.erasureEpoch}:${currentPayload.readAt.snapshotRevision}`
          : null;
        if (readKey && savedReads.has(readKey)) {
          const existing = await loadOfflineManifest(tripId).catch(() => null);
          if (existing) {
            if (setSaved(existing, savedAtStart)) setMessage("");
            return;
          }
          savedReads.delete(readKey);
        }
        const claimed = await claimOfflineManifestSnapshot(currentPayload, {
          onStale: () => invalidateManifestRead(tripId),
        });
        if (claimed === OFFLINE_MANIFEST_STALE_READ) {
          // The copy already on this device stands: drop "Saving…" rather
          // than leave it up if the re-read never lands.
          if (!opts.silent) {
            const existing = await loadOfflineManifest(tripId).catch(() => null);
            setMessage(existing ? "" : copy.saveErrorFallback);
          }
          // One re-read per stale claim, never a loop: if the re-read's own
          // claim is stale too, stop and leave it to the next refresh trigger.
          if (staleReread.current) {
            staleReread.current = false;
          } else {
            staleReread.current = requestManifestReread(tripId);
          }
          return;
        }
        staleReread.current = false;
        if (!claimed) throw new Error(copy.saveErrorFallback);
        const envelope = await saveOfflineManifest(claimed, { tenantRound });
        if (readKey) savedReads.add(readKey);
        if (!setSaved(envelope, savedAtStart)) return;
        counters.pending.current = pendingOfflineEventCount(envelope);
        counters.rejected.current = rejectedOfflineEventCount(envelope);
        counters.cutoff.current = noteDispositionCount(envelope, "discarded_erasure_cutoff");
        counters.unverified.current = noteDispositionCount(
          envelope,
          "discarded_unverified_snapshot",
        );
        // Settled: clear the narration rather than restating the outcome. Once
        // the save lands, the pills say "Online / Fresh copy" and the line
        // under them says when it was saved and what is still owed — a fourth
        // sentence ("This device has an up-to-date offline copy.") saying the
        // same thing is what made this card read as three status readouts
        // stacked on each other. Anything the pills *don't* cover — saving,
        // an error, a reconcile outcome, no signal — still lands here.
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : copy.saveErrorFallback);
      } finally {
        if (!opts.silent) setBusy(false);
      }
    },
    [copy, tripId, setSaved, savedRevision, counters],
  );

  const save = useCallback(
    async (opts: { silent: boolean }) => {
      if (!tripId) return;
      if (inFlight.current) {
        // Prefer a queued non-silent request over a queued silent one, so a
        // manual click's loud feedback isn't dropped in favor of an
        // already-queued background pass.
        queuedSave.current =
          queuedSave.current && !queuedSave.current.silent ? queuedSave.current : opts;
        return inFlight.current;
      }
      const run = (async () => {
        let current: { silent: boolean } | undefined = opts;
        // Drains any request(s) queued while this ran, always against the
        // freshest payloadRef at the time each one actually executes.
        while (current) {
          await runSaveOnce(current);
          current = queuedSave.current ?? undefined;
          queuedSave.current = null;
        }
      })();
      inFlight.current = run;
      try {
        await run;
      } finally {
        inFlight.current = null;
      }
    },
    [tripId, runSaveOnce],
  );

  // Saves as soon as there's a new payload to save — on first mount, and
  // again whenever router.refresh() (below) actually lands a fresh server
  // render, which is the only time this component has newer data than what
  // it already wrote. `payload` itself isn't read in this closure (`save`
  // reads it via `payloadRef`) but is listed deliberately — it's the signal
  // a fresh save is worth doing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: payload is an intentional re-run signal, see above
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    (async () => {
      const initialRevision = savedRevision.current;
      const envelope = await loadOfflineManifest(tripId).catch(() => null);
      if (cancelled) return;
      const accepted = setSaved(envelope, initialRevision);
      // The pills and the saved-summary line take over the moment there is an
      // envelope for them to describe — "Checking this device…" only stands in
      // for a card with nothing on it yet, and left up beside "Fresh copy ·
      // Saved 9:30 AM" it is a fourth voice saying the same thing. A failure
      // from the save below still lands in this same region.
      if (accepted && envelope) setMessage("");
      // Reflects reality even when the branch below can't run yet (e.g. this
      // mount happens while offline) — otherwise reconcile()'s "did anything
      // just resolve/newly reject" check compares against a stale 0 once
      // connectivity returns, on a device that already had events from before.
      if (accepted) {
        counters.pending.current = envelope ? pendingOfflineEventCount(envelope) : 0;
        counters.rejected.current = envelope ? rejectedOfflineEventCount(envelope) : 0;
        counters.cutoff.current = noteDispositionCount(envelope, "discarded_erasure_cutoff");
        counters.unverified.current = noteDispositionCount(
          envelope,
          "discarded_unverified_snapshot",
        );
      }
      if (navigator.onLine) {
        const manual = manualRefreshPending.current;
        manualRefreshPending.current = false;
        await save({ silent: !manual });
        if (cancelled) return;
        setSettled(true);
        await reconcile();
      } else {
        if (accepted) setMessage(envelope ? copy.offlineWithSavedCopy : copy.offlineNoSavedCopy);
        setSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, payload, save, reconcile, savedRevision, setSaved]);

  // Refresh the *server* data this device would save, rather than
  // re-encrypting whatever `payload` happened to be captured at the last
  // render — otherwise a background pass just re-timestamps stale data as a
  // falsely "Fresh copy". The actual save runs once the refreshed payload
  // lands as a prop, in the effect above; reconcile (flushing pending
  // roll-call events) doesn't need fresh manifest data, so it runs directly.
  const refresh = useCallback(
    (opts: { manual: boolean }) => {
      if (!navigator.onLine) {
        // router.refresh() can't fetch anything with no network, so it would
        // never deliver the new payload the effect above is waiting for —
        // that'd leave a manual click's busy/disabled state stuck forever.
        if (opts.manual) setMessage(copy.refreshNoSignal);
        return;
      }
      if (opts.manual) {
        manualRefreshPending.current = true;
        setBusy(true);
        setMessage(copy.savingMessage);
      }
      router.refresh();
      void reconcile();
    },
    [router, reconcile, copy],
  );

  useEffect(() => {
    if (!tripId) return;
    const onOnline = () => {
      if (!navigator.onLine) return;
      // The freshness owner requests the correlated read on reconnect.
      // Reconcile the queued events without issuing a second independent read.
      if (hasManifestRereadOwner(tripId)) void reconcile();
      else refresh({ manual: false });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) refresh({ manual: false });
    };
    const interval = setInterval(() => {
      if (navigator.onLine) refresh({ manual: false });
    }, AUTO_REFRESH_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [tripId, refresh, reconcile]);

  // Primary trigger — see ADR 20260726-manifest-push-refresh. `EventSource`
  // reconnects on its own when the stream drops, and the route deliberately
  // retires each stream a few minutes in (rather than being killed at Vercel's
  // duration limit) with a `retry` hint that sets how fast this reconnects —
  // so this effect doesn't need its own retry logic. When the stream never
  // connects at all (e.g. blocked by a captive portal), or a change lands
  // inside a reconnect gap, the interval/reconnect/visibility effect above is
  // what still keeps this device current.
  useEffect(() => {
    if (!tripId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/trips/${tripId}/manifest-events`);
    const onManifestChanged = () => {
      if (navigator.onLine) refresh({ manual: false });
    };
    source.addEventListener("manifest-changed", onManifestChanged);
    return () => {
      source.removeEventListener("manifest-changed", onManifestChanged);
      source.close();
    };
  }, [tripId, refresh]);

  // Third trigger — see ADR 20260804-manifest-web-push. A Web Push wakes the
  // service worker even when this page is frozen, and the worker forwards it
  // here. When the page is merely hidden on an awake device this refreshes with
  // no tap at all; when the page was evicted entirely there is nothing to
  // receive it, and the notification the worker showed is what brings the
  // captain back. The worker deliberately never writes the snapshot itself —
  // this line is why it doesn't have to.
  useEffect(() => {
    if (!tripId || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "MANIFEST_CHANGED") return;
      // A device can hold subscriptions for more than one trip; only the page
      // whose trip changed should refresh.
      if (event.data.tripId && event.data.tripId !== tripId) return;
      if (navigator.onLine) refresh({ manual: false });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [tripId, refresh]);
  return { tripId, saved, message, busy, settled, refresh };
}
