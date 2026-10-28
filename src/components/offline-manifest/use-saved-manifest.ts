import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { isRollCallCheckpoint, type RollCallCheckpoint } from "@/lib/manifests";
import {
  acknowledgeDiscardedOfflineRecords,
  type DiscardedOfflineRecord,
  listOfflineManifests,
  loadOfflineManifest,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  type OfflineManifestEnvelope,
  offlineFallbackReason,
  pendingOfflineEventCount,
  rejectedOfflineEventCount,
} from "@/lib/offline-manifests";
import type { CopyCaveat } from "./controls";
import { savedCopyReducer } from "./saved-copy";
import { useCrossShopPurge } from "./use-cross-shop-purge";
import { useOfflineTenant } from "./use-offline-tenant";

/**
 * **The copy this device holds, and keeping it honest**: the saved record (or
 * the list of them), the checkpoint, the status line, what retention threw
 * away, and the reconcile passes that sync it once there is signal.
 */
export function useSavedManifest(t: OfflineManifestTranslator) {
  const searchParams = useSearchParams();
  const [{ envelope, removedForOtherShop }, dispatchSaved] = useReducer(savedCopyReducer, {
    envelope: null,
    goneUnderTenant: null,
    removedForOtherShop: null,
  });
  const [list, setList] = useState<OfflineManifestEnvelope[] | null>(null);
  // A failed reload of the live manifest carries its checkpoint through the
  // redirect (see manifest-sw.js) so a captain mid "After dive 1" roll call
  // doesn't land back on "Before departure". This first pass only checks the
  // value's shape — the trip's actual planned-dive count isn't known until
  // the envelope loads below, so an in-range-looking but nonexistent
  // checkpoint (a stale URL, a trip whose dive count later shrank) is caught
  // once that arrives. Without that second check, `checkpoint` would disagree
  // with the manifest actually rendered (the lookup below falls back to the
  // first saved manifest), misrecording roll-call actions and misreporting
  // `isDeparture` against a checkpoint that isn't the one on screen.
  const [checkpoint, setCheckpoint] = useState<RollCallCheckpoint>(() => {
    const requested = searchParams.get("checkpoint");
    return requested && /^(departure|after_dive_\d+)$/.test(requested)
      ? (requested as RollCallCheckpoint)
      : "departure";
  });
  const [message, setMessage] = useState(t("shared.offlineManifest.loadingMessage"));
  // False until this device's storage has actually been read. Two things ride
  // on it, and both are load-bearing on the one surface that exists for having
  // no signal:
  //
  // 1. **It stops the shell asserting what it hasn't checked.** `envelope` and
  //    `list` both start `null`, which means "not looked yet", but every branch
  //    below read that as "nothing there" and rendered "Nothing saved on this
  //    phone yet" — a definitive claim about a safety artifact, made before the
  //    store was opened, directly contradicting the "Opening the manifest saved
  //    on this device…" status line printed underneath it.
  //
  // 2. **It makes the server render URL-agnostic, which is what the cached
  //    offline shell actually is.** `manifest-sw.js` caches one document under
  //    the key `/offline-manifest` and replays it for *every* offline reload,
  //    whatever `?trip=`/`?checkpoint=` the captain was on. That document was
  //    rendered by the server for whichever URL happened to fetch it — normally
  //    the bare path, so its markup is the *list* branch. The reloaded page
  //    therefore used to paint a different page than the one requested, and only
  //    became correct via React's hydration-mismatch recovery (a recoverable
  //    hydration error fired on every single offline reload, measured). Gating
  //    on a state the server can never have true means the server always emits
  //    this one neutral view, the client hydrates against a match, and the real
  //    branch is chosen by an ordinary client render instead of by error
  //    recovery.
  const [storeRead, setStoreRead] = useState(false);
  // True when that read threw (#2637): a copy may exist and simply failed to
  // open, which the screen must never word as "nothing saved".
  const [storeReadFailed, setStoreReadFailed] = useState(false);
  /**
   * Unsynced roll call this device threw away at the retention ceiling
   * (`OFFLINE_MANIFEST_PENDING_GRACE_MS`). Read from storage rather than
   * handed over by whatever triggered the delete: it usually happens where
   * there is no screen — the service worker's push refresh, the staff layout's
   * auto-save — so this surface is the first place a human can be told.
   */
  const [discarded, setDiscarded] = useState<DiscardedOfflineRecord[]>([]);
  const tripId = useMemo(() => searchParams.get("trip") ?? "", [searchParams]);
  // The service worker sent the captain here because DiveDay did not answer
  // (`OFFLINE_FALLBACK_PARAM`), not because they opened the saved copy. While
  // the device reads "online" that is the misleading case: a copy minutes old
  // would read "Online · Fresh copy · current" (captain review B1). Offline,
  // the ordinary wording already says "No signal", so it is used as is.
  const deviceOnline = useDeviceOnline();
  const fallback = useMemo(() => offlineFallbackReason(searchParams), [searchParams]);
  const servedWithoutAnswer = fallback !== null && deviceOnline;
  // **What the roll call says this copy may be missing** (issue #2980, domain
  // reviews 2026-10-24). Kept apart from the header's wording above: offline,
  // the header says "No signal", but the copy is just as stale, so the caveat
  // stays, and only its instruction changes to the count on the boat. Every
  // saved copy carries one (re-review 2026-10-24): one opened with signal can
  // be as short as any, and only this page is ever a saved copy.
  const copyCaveat: CopyCaveat = !deviceOnline
    ? "offline"
    : servedWithoutAnswer
      ? "unanswered"
      : "online";
  // Freshness (current/aging/stale) is computed inline at render time from
  // `saved.snapshot.savedAt`/`envelope.snapshot.savedAt`, so nothing re-renders
  // this component as the wall clock crosses the 15-minute or 4-hour
  // threshold on its own — a captain who leaves this page open would
  // otherwise see "Fresh copy" read as current indefinitely. This forces a
  // re-render every minute, well under either threshold's own granularity,
  // purely to re-run that computation against the current time.
  const [, forceFreshnessRecompute] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceFreshnessRecompute((tick) => tick + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  const { tenantSlugRef, resolveTenant } = useOfflineTenant();

  const refreshDiscarded = useCallback(() => {
    readDiscardedOfflineRecords()
      .then(setDiscarded)
      // Best-effort by design: a device whose storage cannot be read has
      // bigger problems, and both branches below already say so on their own.
      .catch(() => {});
  }, []);

  const reconcileOnce = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    // Same rule `reconcileList` applies to the device-wide list, and it belongs
    // here at least as much (security review, 2026-08-06): a foreign shop's
    // record is *deliberately preserved* by the purge while it still holds a
    // pending event, and it is listed and tappable. Submitting that event under
    // whatever shop is currently signed in gets it rejected for a tenant
    // mismatch rather than a real domain refusal — and a rejected event is no
    // longer "pending", so the very next purge pass deletes the record outright.
    // That destroys the only copy of a boarding record. If the tenant cannot be
    // established, reconcile nothing rather than guess.
    const slug = await resolveTenant();
    if (!slug) return;
    const held = await loadOfflineManifest(tripId).catch(() => null);
    if (!held || held.snapshot.shop.slug !== slug) return;
    try {
      const next = await syncOfflineManifest(tripId);
      if (!next) return;
      dispatchSaved({ type: "loaded", envelope: next });
      // All three queues, not roll call alone: a checklist tap or an arrival
      // waiting to sync is evidence this device is holding, and a count that
      // cannot see it tells a captain they are caught up when they are not.
      const rejected = rejectedOfflineEventCount(next);
      const pending = pendingOfflineEventCount(next);
      const noteCutoffDiscarded = next.events.some(
        (event) => event.noteDisposition === "discarded_erasure_cutoff",
      );
      const noteUnverifiedDiscarded = next.events.some(
        (event) => event.noteDisposition === "discarded_unverified_snapshot",
      );
      const messages = [
        ...(rejected > 0
          ? [t("shared.offlineManifest.reconcile.pendingRejectedSingle", { count: rejected })]
          : []),
        ...(noteCutoffDiscarded ? [t("shared.offlineManifest.reconcile.noteDiscarded")] : []),
        ...(noteUnverifiedDiscarded ? [t("shared.offlineManifest.reconcile.noteUnverified")] : []),
        ...(rejected === 0 && !noteCutoffDiscarded && !noteUnverifiedDiscarded
          ? [
              pending > 0
                ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })
                : t("shared.offlineManifest.reconcile.allCaughtUp"),
            ]
          : []),
      ];
      setMessage(messages.join(" "));
    } catch {
      setMessage(t("shared.offlineManifest.reconcile.reachError"));
    }
  }, [tripId, t, resolveTenant]);

  // **One sync at a time, and at most one waiting** (captain review S2). Every
  // tap asks for a pass, and a pass on a link that carries nothing takes the
  // whole `SYNC_TIMEOUT_MS`; unserialized, ten taps counting a boat back
  // aboard were ten overlapping POSTs of the same pending events. Taps made
  // while a pass runs fold into the one queued behind it, which sends
  // everything pending by the time it starts. The same pattern
  // `useOfflineManifestSync` keeps for the live page.
  const reconcileInFlight = useRef<Promise<void> | null>(null);
  const reconcileQueued = useRef(false);
  const reconcile = useCallback(async () => {
    if (reconcileInFlight.current) {
      reconcileQueued.current = true;
      return reconcileInFlight.current;
    }
    // The pass lets go in the same step that finds nothing queued, with no
    // await between them: an ask can only find a pass still running, which
    // takes it, or none, and starts one (re-review N10). Letting go after
    // `await run` left a microtask or two where an ask joined a pass that had
    // already finished, and sat pending until the next tap.
    const run = (async () => {
      try {
        do {
          reconcileQueued.current = false;
          await reconcileOnce();
        } while (reconcileQueued.current);
      } finally {
        reconcileInFlight.current = null;
      }
    })();
    reconcileInFlight.current = run;
    await run;
  }, [reconcileOnce]);

  // Reconciles every saved trip that still has a pending roll-call event, not
  // just the one a captain happens to open next — otherwise a change recorded
  // offline for a trip the captain never revisits individually would sit
  // pending forever despite "every change is double-checked... once you're
  // back in service" (see the P1 fix in ADR
  // 20260726-shopwide-offline-manifest-priming's review follow-up).
  const reconcileList = useCallback(
    async (saved: OfflineManifestEnvelope[], currentShopSlug: string | null) => {
      if (!navigator.onLine) return;
      const withPending = saved.filter((envelope) => pendingOfflineEventCount(envelope) > 0);
      if (withPending.length === 0) return;
      // Only ever sync a trip belonging to whichever shop this browser is
      // actually authenticated as right now. This view has no session context
      // of its own (it's designed to work fully offline/unauthenticated), so a
      // preserved foreign-shop pending event — kept alive specifically because
      // it can't be reconciled under the wrong tenant, see
      // purgeOfflineManifestsExceptShop — would otherwise get submitted under
      // whatever shop *is* currently signed in, rejected for a tenant mismatch
      // rather than a genuine domain refusal, and then look "resolved" to the
      // very next purge pass, which would delete it outright. The
      // server-verified current shop is resolved once by the caller (it also
      // drives the cross-tenant purge); if it can't be determined (offline,
      // signed out, request failure), reconcile nothing rather than guess.
      if (!currentShopSlug) return;
      const reconcilable = withPending.filter(
        (envelope) => envelope.snapshot.shop.slug === currentShopSlug,
      );
      if (reconcilable.length === 0) return;
      const results = await Promise.all(
        reconcilable.map((envelope) => {
          const id = envelope.snapshot.manifests[0]?.trip.id;
          return id ? syncOfflineManifest(id).catch(() => null) : Promise.resolve(null);
        }),
      );
      const byId = new Map(
        results
          .filter((envelope): envelope is OfflineManifestEnvelope => envelope !== null)
          .map((envelope) => [envelope.snapshot.manifests[0]?.trip.id ?? "", envelope] as const),
      );
      const merged = saved.map((envelope) => {
        const id = envelope.snapshot.manifests[0]?.trip.id;
        return id && byId.has(id) ? (byId.get(id) as OfflineManifestEnvelope) : envelope;
      });
      setList(merged);
      const rejected = merged.reduce(
        (sum, envelope) => sum + rejectedOfflineEventCount(envelope),
        0,
      );
      const pending = merged.reduce((sum, envelope) => sum + pendingOfflineEventCount(envelope), 0);
      if (rejected > 0) {
        setMessage(t("shared.offlineManifest.reconcile.listPendingRejected", { count: rejected }));
      } else if (pending === 0) {
        setMessage(t("shared.offlineManifest.reconcile.listAllCaughtUp"));
      }
    },
    [t],
  );

  useCrossShopPurge({
    tripId,
    tenantSlugRef,
    resolveTenant,
    dispatchSaved,
    setList,
    refreshDiscarded,
  });

  useEffect(() => {
    if (!tripId) {
      // No specific trip requested — this is the dive.day-root/shell landing
      // page (see ADR 20260726-shopwide-offline-manifest-priming), so list
      // whatever this device already has rather than asking for a trip id.
      const showList = (saved: OfflineManifestEnvelope[]) => {
        setList(saved);
        // Nothing saved says nothing here: the empty page's heading already
        // says it, and the status line under it repeated it word for word
        // (UX review 2026-10-10, item 33).
        setMessage(
          saved.length > 0
            ? t("shared.offlineManifest.reconcile.savedCount", { count: saved.length })
            : "",
        );
      };

      const refreshList = () =>
        listOfflineManifests()
          .then(async (saved) => {
            // Paint from storage alone, before anything touches the network —
            // the whole premise of this surface. The cross-shop purge runs in
            // its own effect above and repaints if it removes anything.
            showList(saved);
            setStoreReadFailed(false);
            setStoreRead(true);
            void reconcileList(saved, await resolveTenant());
          })
          .catch(() => {
            setStoreReadFailed(true);
            setMessage(t("shared.offlineManifest.reconcile.listLoadError"));
          })
          // Settled either way: a device whose storage can't be opened at all
          // has still been *looked at*, and the error message it lands on says
          // more than an "opening…" state that never ends.
          .finally(() => {
            setStoreRead(true);
            // The read above is itself a moment the retention ceiling can fire
            // (it decrypts every record), so ask what it discarded — not only
            // after a purge round.
            refreshDiscarded();
          });
      void refreshList();
      window.addEventListener("online", refreshList);
      return () => window.removeEventListener("online", refreshList);
    }
    loadOfflineManifest(tripId)
      .then((saved) => {
        dispatchSaved({ type: "loaded", envelope: saved });
        setStoreReadFailed(false);
        // The requested checkpoint's shape was checked before the trip's
        // planned-dive count was known; re-validate against it now so a
        // stale or out-of-range checkpoint (from an edited URL, or a trip
        // whose dive count shrank since it was saved) can't leave `checkpoint`
        // pointing at something the manifest lookup below silently falls back
        // away from.
        const plannedDives = saved?.snapshot.manifests[0]?.trip.plannedDives;
        if (plannedDives !== undefined) {
          setCheckpoint((current) =>
            isRollCallCheckpoint(current, plannedDives) ? current : "departure",
          );
        }
        setMessage(
          saved
            ? t("shared.offlineManifest.reconcile.ready")
            : t("shared.offlineManifest.reconcile.noneForTrip"),
        );
        if (saved && navigator.onLine) void reconcile();
      })
      .catch(() => {
        setStoreReadFailed(true);
        setMessage(t("shared.offlineManifest.reconcile.singleLoadError"));
      })
      .finally(() => {
        setStoreRead(true);
        refreshDiscarded();
      });
    window.addEventListener("online", reconcile);
    return () => window.removeEventListener("online", reconcile);
  }, [reconcile, reconcileList, refreshDiscarded, resolveTenant, tripId, t]);

  const acknowledgeDiscarded = () => {
    // Cleared on screen first: the button must feel instant on a boat, and if
    // the write behind it fails the notice simply comes back on the next open,
    // which is the right direction for something that reports lost evidence.
    setDiscarded([]);
    void acknowledgeDiscardedOfflineRecords().catch(() => {});
  };

  return {
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
    storeReadFailed,
    discarded,
    acknowledgeDiscarded,
    reconcile,
    fallback,
    servedWithoutAnswer,
    copyCaveat,
  };
}

/** `navigator.onLine`, kept current. This view renders only on the device. */
function useDeviceOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}
