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
import type { OfflineChecklistEvent, OfflineRollCallEvent } from "@/lib/offline-manifests";
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
import { useSavedManifestList } from "./use-saved-manifest-list";

function describeDiscardedNoteEvent(
  event: OfflineRollCallEvent | OfflineChecklistEvent,
  t: OfflineManifestTranslator,
  includeTripReference = false,
) {
  const isChecklist = "checklistItemId" in event;
  const subjectId = isChecklist
    ? event.checklistItemId
    : (event.bookingId ?? event.crewPersonId ?? "unknown");
  const subject = isChecklist
    ? t("shared.offlineManifest.reconcile.noteChecklistReference", {
        reference: subjectId.slice(-8),
      })
    : event.bookingId
      ? t("shared.offlineManifest.reconcile.noteDiverReference", {
          reference: subjectId.slice(-8),
        })
      : t("shared.offlineManifest.reconcile.noteCrewReference", {
          reference: subjectId.slice(-8),
        });
  const checkpoint =
    "checkpoint" in event
      ? event.checkpoint === "departure"
        ? t("shared.rollCallCheckpoint.departure")
        : t("shared.rollCallCheckpoint.afterDive", {
            n: Number(event.checkpoint.slice("after_dive_".length)),
          })
      : t("shared.offlineManifest.reconcile.checklistLocation");
  const result = t(
    event.syncStatus === "rejected"
      ? "shared.offlineManifest.reconcile.noteMarkNeedsReview"
      : "shared.offlineManifest.reconcile.noteMarkKept",
  );
  const entry = t("shared.offlineManifest.reconcile.noteEntry", { subject, checkpoint, result });
  return includeTripReference
    ? t("shared.offlineManifest.reconcile.noteEntryWithTrip", {
        trip: t("shared.offlineManifest.reconcile.noteTripReference", {
          reference: event.tripId.slice(-8),
        }),
        entry,
      })
    : entry;
}

function discardedNoteMessage(
  events: readonly (OfflineRollCallEvent | OfflineChecklistEvent)[],
  t: OfflineManifestTranslator,
  includeTripReference = false,
) {
  const cutoff = events.filter((event) => event.noteDisposition === "discarded_erasure_cutoff");
  const unverified = events.filter(
    (event) => event.noteDisposition === "discarded_unverified_snapshot",
  );
  const describe = (event: OfflineRollCallEvent | OfflineChecklistEvent) =>
    describeDiscardedNoteEvent(event, t, includeTripReference);
  return [
    ...(cutoff.length
      ? [t("shared.offlineManifest.reconcile.noteDiscarded"), ...cutoff.map(describe)]
      : []),
    ...(unverified.length
      ? [t("shared.offlineManifest.reconcile.noteUnverified"), ...unverified.map(describe)]
      : []),
  ].join("\n");
}

function listNoteLossMessage(
  envelopes: readonly OfflineManifestEnvelope[],
  t: OfflineManifestTranslator,
  currentShopSlug: string | null,
) {
  // Offline, the server cannot verify which shop is signed in. Product policy
  // accepts showing non-name, non-note-text references from locally saved
  // manifests in that state; a verified online tenant scopes them after purge.
  const scopedEnvelopes = currentShopSlug
    ? envelopes.filter((saved) => saved.snapshot.shop.slug === currentShopSlug)
    : envelopes;
  const events = scopedEnvelopes.flatMap((saved) => [...saved.events, ...saved.checklistEvents]);
  if (events.length === 0) return "";
  const cutoff = events.filter((event) => event.noteDisposition === "discarded_erasure_cutoff");
  const unverified = events.filter(
    (event) => event.noteDisposition === "discarded_unverified_snapshot",
  );
  const describe = (event: OfflineRollCallEvent | OfflineChecklistEvent) =>
    describeDiscardedNoteEvent(event, t, true);
  return [
    ...(cutoff.length
      ? [t("shared.offlineManifest.reconcile.noteDiscardedList"), ...cutoff.map(describe)]
      : []),
    ...(unverified.length
      ? [t("shared.offlineManifest.reconcile.noteUnverifiedList"), ...unverified.map(describe)]
      : []),
  ].join("\n");
}

function isShopChangedError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === "shop_changed"
  );
}

function initialListMessage(
  envelopes: readonly OfflineManifestEnvelope[],
  t: OfflineManifestTranslator,
  currentShopSlug: string | null = null,
) {
  const visibleEnvelopes = currentShopSlug
    ? envelopes.filter((saved) => saved.snapshot.shop.slug === currentShopSlug)
    : envelopes;
  return [
    ...(visibleEnvelopes.length > 0
      ? [t("shared.offlineManifest.reconcile.savedCount", { count: visibleEnvelopes.length })]
      : []),
    listNoteLossMessage(visibleEnvelopes, t, currentShopSlug),
  ]
    .filter(Boolean)
    .join("\n");
}

function reconciledListMessage(
  envelopes: readonly OfflineManifestEnvelope[],
  t: OfflineManifestTranslator,
  currentShopSlug: string,
) {
  const authorized = envelopes.filter(
    (envelope) => envelope.snapshot.shop.slug === currentShopSlug,
  );
  const rejected = authorized.reduce(
    (sum, envelope) => sum + rejectedOfflineEventCount(envelope),
    0,
  );
  const pending = authorized.reduce((sum, envelope) => sum + pendingOfflineEventCount(envelope), 0);
  const noteLoss = listNoteLossMessage(authorized, t, currentShopSlug);
  const syncMessage =
    rejected > 0
      ? t("shared.offlineManifest.reconcile.listPendingRejected", { count: rejected })
      : pending > 0
        ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })
        : noteLoss
          ? ""
          : t("shared.offlineManifest.reconcile.listAllCaughtUp");
  return [syncMessage, noteLoss].filter(Boolean).join("\n");
}

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
  const listRef = useRef<OfflineManifestEnvelope[] | null>(null);
  listRef.current = list;
  // Null until the server has answered on this mount. A snapshot's shop slug
  // is useful for display, never proof of the currently authenticated tenant.
  const verifiedTenantSlugRef = useRef<string | null>(null);
  const [verifiedTenantRevision, setVerifiedTenantRevision] = useState(0);
  const [tenantChangePending, setTenantChangePending] = useState(false);
  const [tenantChangeRevision, setTenantChangeRevision] = useState(0);
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
  // A saved-trip load can finish after an online cross-shop purge confirms the
  // copy is gone. Its reducer action is fenced, and so must its note-loss
  // message be.
  const tripPurgedRef = useRef(false);
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

  const handleTenantChanged = useCallback(() => {
    // A 409 is an explicit server assertion that the tenant verified when
    // this sync began is no longer current. Stop showing that tenant's roster
    // and controls immediately, retain its encrypted pending events, and make
    // the cross-shop purge perform a fresh identity lookup.
    tenantSlugRef.current = null;
    verifiedTenantSlugRef.current = null;
    setTenantChangePending(true);
    setMessage(t("shared.offlineManifest.reconcile.tenantChanged"));
    dispatchSaved({ type: "tenant-changed" });
    setList(null);
    setTenantChangeRevision((revision) => revision + 1);
  }, [t, tenantSlugRef]);

  const tripNoticeForEnvelope = useCallback(
    (saved: OfflineManifestEnvelope | null) => {
      if (!saved) return "";
      const verifiedSlug = verifiedTenantSlugRef.current;
      if (verifiedSlug && saved.snapshot.shop.slug !== verifiedSlug) return null;
      return discardedNoteMessage([...saved.events, ...saved.checklistEvents], t);
    },
    [t],
  );

  const initialMessageForList = useCallback(
    (saved: OfflineManifestEnvelope[]) =>
      initialListMessage(saved, t, verifiedTenantSlugRef.current),
    [t],
  );

  const initialMessageForShop = useCallback(
    (saved: OfflineManifestEnvelope[], slug: string) => initialListMessage(saved, t, slug),
    [t],
  );
  const reconciledMessageForShop = useCallback(
    (saved: OfflineManifestEnvelope[], slug: string) => reconciledListMessage(saved, t, slug),
    [t],
  );

  useEffect(() => {
    if (!tripId || !envelope || verifiedTenantRevision === 0 || tripPurgedRef.current) return;
    const noteMessage = tripNoticeForEnvelope(envelope);
    setMessage(
      noteMessage === null ? "" : noteMessage || t("shared.offlineManifest.reconcile.ready"),
    );
  }, [tripId, envelope, verifiedTenantRevision, tripNoticeForEnvelope, t]);

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
    // another shop used to settle it as a per-event refusal, after which the
    // next purge could delete the only local evidence. The route now fences a
    // tenant change at batch level, and this check keeps us from submitting at
    // all when the tenant cannot be established.
    const slug = await resolveTenant();
    if (!slug) return;
    const held = await loadOfflineManifest(tripId).catch(() => null);
    if (!held) return;
    if (held.snapshot.shop.slug !== slug) {
      // A retained foreign pending record is not deleted by the purge, but its
      // loss references are no longer authorized once the online tenant is
      // known. Marks and queued evidence remain in IndexedDB.
      if (discardedNoteMessage([...held.events, ...held.checklistEvents], t)) setMessage("");
      return;
    }
    try {
      const next = await syncOfflineManifest(tripId, slug);
      if (!next) return;
      // The request may have been answered under the previous session just as
      // the device verified a different tenant. Never paint that response on
      // the now-authorized surface.
      if (tenantSlugRef.current !== slug) return;
      dispatchSaved({ type: "loaded", envelope: next });
      // All three queues, not roll call alone: a checklist tap or an arrival
      // waiting to sync is evidence this device is holding, and a count that
      // cannot see it tells a captain they are caught up when they are not.
      const rejected = rejectedOfflineEventCount(next);
      const pending = pendingOfflineEventCount(next);
      const noteMessage = discardedNoteMessage([...next.events, ...next.checklistEvents], t);
      const messages = [
        ...(rejected > 0
          ? [t("shared.offlineManifest.reconcile.pendingRejectedSingle", { count: rejected })]
          : []),
        ...(noteMessage ? [noteMessage] : []),
        ...(rejected === 0 && !noteMessage
          ? [
              pending > 0
                ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })
                : t("shared.offlineManifest.reconcile.allCaughtUp"),
            ]
          : []),
      ];
      setMessage(messages.join(" "));
    } catch (error) {
      if (tenantSlugRef.current !== slug) return;
      if (isShopChangedError(error)) {
        handleTenantChanged();
        return;
      }
      setMessage(t("shared.offlineManifest.reconcile.reachError"));
    }
  }, [tripId, t, resolveTenant, tenantSlugRef, handleTenantChanged]);

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

  const reconcileList = useSavedManifestList({
    tenantSlugRef,
    initialListMessage: initialMessageForShop,
    reconciledListMessage: reconciledMessageForShop,
    setList,
    setMessage,
    handleTenantChanged,
  });

  const onListPurged = useCallback(
    (saved: OfflineManifestEnvelope[], currentShopSlug: string) => {
      // The purge hook calls this only after re-reading IndexedDB under the
      // server-verified tenant. Recompute rather than leaving a pre-purge
      // notice in React state after foreign records have been removed.
      if (tenantSlugRef.current === currentShopSlug) {
        setMessage(initialListMessage(saved, t, currentShopSlug));
      }
    },
    [t, tenantSlugRef],
  );

  const onTripPurged = useCallback(() => {
    tripPurgedRef.current = true;
    setMessage("");
  }, []);

  const onTenantVerified = useCallback(
    (currentShopSlug: string) => {
      setTenantChangePending(false);
      verifiedTenantSlugRef.current = currentShopSlug;
      // Re-scope before the purge's store read finishes. Foreign pending copies
      // remain stored for their shop to reconcile but are no longer disclosed.
      if (tripId) {
        const visibleEnvelope = envelope?.snapshot.shop.slug === currentShopSlug ? envelope : null;
        const noteMessage = tripNoticeForEnvelope(visibleEnvelope);
        setMessage(
          noteMessage === null
            ? ""
            : noteMessage || (visibleEnvelope ? t("shared.offlineManifest.reconcile.ready") : ""),
        );
      } else {
        setMessage(initialListMessage(listRef.current ?? [], t, currentShopSlug));
      }
      setVerifiedTenantRevision((revision) => revision + 1);
    },
    [envelope, t, tripId, tripNoticeForEnvelope],
  );

  useCrossShopPurge({
    tripId,
    tenantSlugRef,
    resolveTenant,
    dispatchSaved,
    setList,
    onListPurged,
    onTenantVerified,
    onTripPurged,
    refreshDiscarded,
    tenantChangeRevision,
  });

  useEffect(() => {
    // A fresh authenticated identity is a fresh attempt to load the device
    // copy, even if the URL and its trip id did not change.
    if (verifiedTenantRevision > 0) setStoreReadFailed(false);
    if (!tripId) {
      tripPurgedRef.current = false;
      // No specific trip requested — this is the dive.day-root/shell landing
      // page (see ADR 20260726-shopwide-offline-manifest-priming), so list
      // whatever this device already has rather than asking for a trip id.
      const showList = (saved: OfflineManifestEnvelope[]) => {
        setList(saved);
        // Nothing saved says nothing here: the empty page's heading already
        // says it, and the status line under it repeated it word for word
        // (UX review 2026-10-10, item 33).
        setMessage(initialMessageForList(saved));
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
    tripPurgedRef.current = false;
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
        const noteMessage = tripNoticeForEnvelope(saved);
        if (!tripPurgedRef.current) {
          setMessage(
            noteMessage === null
              ? ""
              : noteMessage ||
                  (saved
                    ? t("shared.offlineManifest.reconcile.ready")
                    : t("shared.offlineManifest.reconcile.noneForTrip")),
          );
        }
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
  }, [
    reconcile,
    reconcileList,
    refreshDiscarded,
    resolveTenant,
    tripId,
    t,
    verifiedTenantRevision,
    initialMessageForList,
    tripNoticeForEnvelope,
  ]);

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
    verifiedTenantSlug: verifiedTenantRevision > 0 ? verifiedTenantSlugRef.current : null,
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
