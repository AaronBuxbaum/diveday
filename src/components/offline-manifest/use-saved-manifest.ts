import { useSearchParams } from "next/navigation";
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { OfflineManifestTranslator } from "@/i18n/offline-manifest-messages";
import type { RollCallCheckpoint } from "@/lib/manifests";
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
  offlineArrivalEvents,
  offlineFallbackReason,
  pendingOfflineEventCount,
  rejectedOfflineEventCount,
} from "@/lib/offline-manifests";
import type { CopyCaveat } from "./controls";
import { savedCopyReducer } from "./saved-copy";
import { useSelectedTripEnvelopeHandler } from "./selected-trip-envelope";
import { initialTripStatusMessage } from "./trip-status";
import { useCrossShopPurge } from "./use-cross-shop-purge";
import { useOfflineTenant } from "./use-offline-tenant";
import {
  foreignPendingTrip,
  hasForeignPendingManifestChanges,
  useSavedManifestList,
  useTripPendingManifestInventory,
} from "./use-saved-manifest-list";

import {
  createSelectedTripStorageState,
  type SelectedTripStorageState,
  useSelectedTripPurgeState,
  useSelectedTripStorage,
} from "./use-selected-trip-storage";

function acknowledgeDiscardedNotices(
  visibleNotices: DiscardedOfflineRecord[],
  setDiscarded: Dispatch<SetStateAction<DiscardedOfflineRecord[]>>,
): void {
  // Clear the button immediately; if persistence fails, the notice returns on
  // the next open. IDs preserve notices that arrived after the UI read.
  const noticeIds = new Set(visibleNotices.map(({ noticeId }) => noticeId));
  setDiscarded((current) => current.filter((notice) => !noticeIds.has(notice.noticeId)));
  void acknowledgeDiscardedOfflineRecords(visibleNotices).catch(() => {});
}

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

function selectedTripNoteLossMessage(
  envelope: OfflineManifestEnvelope | null,
  currentShopSlug: string | null,
  t: OfflineManifestTranslator,
) {
  return envelope && (!currentShopSlug || envelope.snapshot.shop.slug === currentShopSlug)
    ? discardedNoteMessage([...envelope.events, ...envelope.checklistEvents], t)
    : "";
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
  const foreignPending = hasForeignPendingManifestChanges(envelopes, currentShopSlug);
  const noteLoss = listNoteLossMessage(authorized, t, currentShopSlug);
  const syncMessage =
    rejected > 0
      ? t("shared.offlineManifest.reconcile.listPendingRejected", { count: rejected })
      : pending > 0
        ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })
        : noteLoss || foreignPending
          ? ""
          : t("shared.offlineManifest.reconcile.listAllCaughtUp");
  return [syncMessage, noteLoss].filter(Boolean).join("\n");
}

function reconciledTripMessage(
  envelope: OfflineManifestEnvelope,
  t: OfflineManifestTranslator,
  foreignPending: boolean,
  additionalPending = 0,
) {
  const rejected = rejectedOfflineEventCount(envelope);
  const pending = Math.max(pendingOfflineEventCount(envelope), additionalPending);
  const noteMessage = discardedNoteMessage([...envelope.events, ...envelope.checklistEvents], t);
  return [
    ...(rejected > 0
      ? [t("shared.offlineManifest.reconcile.pendingRejectedSingle", { count: rejected })]
      : pending > 0
        ? [t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })]
        : foreignPending || noteMessage
          ? []
          : [t("shared.offlineManifest.reconcile.allCaughtUp")]),
  ]
    .filter(Boolean)
    .join(" ");
}

type TripSyncResult = {
  tripId: string;
  shopSlug: string;
  envelope: OfflineManifestEnvelope;
};

function pendingEventsNotSettledIn(
  synced: OfflineManifestEnvelope,
  inventory: readonly OfflineManifestEnvelope[],
  shopSlug: string,
): number {
  const current = inventory.find(
    (envelope) =>
      envelope.snapshot.shop.slug === shopSlug &&
      envelope.snapshot.manifests[0]?.trip.id === synced.snapshot.manifests[0]?.trip.id,
  );
  if (!current) return 0;
  const settledIds = new Set(
    [...synced.events, ...synced.checklistEvents, ...offlineArrivalEvents(synced)]
      .filter((event) => event.syncStatus !== "pending")
      .map((event) => event.clientEventId),
  );
  return [...current.events, ...current.checklistEvents, ...offlineArrivalEvents(current)].filter(
    (event) => event.syncStatus === "pending" && !settledIds.has(event.clientEventId),
  ).length;
}

function useSelectedTripInventoryStatus({
  tripId,
  tenantSlugRef,
  verifiedTenantRevision,
  verifiedTenantSlugRef,
  lastTripSyncRef,
  setList,
  setMessage,
  t,
}: {
  tripId: string;
  tenantSlugRef: { current: string | null };
  verifiedTenantRevision: number;
  verifiedTenantSlugRef: { current: string | null };
  lastTripSyncRef: MutableRefObject<TripSyncResult | null>;
  setList: (saved: OfflineManifestEnvelope[]) => void;
  setMessage: (message: string | ((message: string) => string)) => void;
  t: OfflineManifestTranslator;
}) {
  const inventoryReadyRef = useRef(false);
  const onInventoryReady = useCallback(
    (saved: OfflineManifestEnvelope[]) => {
      const lastSync = lastTripSyncRef.current;
      const shopSlug = verifiedTenantSlugRef.current;
      if (!lastSync || lastSync.tripId !== tripId || lastSync.shopSlug !== shopSlug || !shopSlug) {
        return;
      }
      const syncedTrip = lastSync.envelope;
      if (syncedTrip.snapshot.shop.slug !== shopSlug) return;
      const pendingFromInventory = pendingEventsNotSettledIn(syncedTrip, saved, shopSlug);
      setMessage(
        reconciledTripMessage(
          syncedTrip,
          t,
          hasForeignPendingManifestChanges(saved, shopSlug),
          pendingFromInventory,
        ),
      );
    },
    [lastTripSyncRef, tripId, verifiedTenantSlugRef, t, setMessage],
  );
  useTripPendingManifestInventory({
    tripId,
    tenantSlugRef,
    verifiedTenantRevision,
    inventoryReadyRef,
    setList,
    setMessage,
    onInventoryReady,
    allCaughtUpMessage: t("shared.offlineManifest.reconcile.allCaughtUp"),
  });
  return inventoryReadyRef;
}

function selectedTripInventoryIsReady(inventoryReadyRef: { current: boolean }) {
  return inventoryReadyRef.current;
}

function beginTripSyncAttempt(
  ref: MutableRefObject<TripSyncResult | null>,
  resolveTenant: () => Promise<string | null>,
  setMessage: Dispatch<SetStateAction<string>>,
  t: OfflineManifestTranslator,
) {
  ref.current = null;
  const caughtUp = t("shared.offlineManifest.reconcile.allCaughtUp");
  setMessage((message) => (message === caughtUp ? "" : message));
  return resolveTenant().then((slug) => {
    if (!slug) setMessage(t("shared.offlineManifest.reconcile.reachError"));
    return slug;
  });
}

function useOnTenantVerified({
  envelope,
  t,
  tripId,
  tripNoticeForEnvelope,
  setTenantChangePending,
  verifiedTenantSlugRef,
  setMessage,
  initialMessageForList,
  listRef,
  setVerifiedTenantRevision,
}: {
  envelope: OfflineManifestEnvelope | null;
  t: OfflineManifestTranslator;
  tripId: string;
  tripNoticeForEnvelope: (saved: OfflineManifestEnvelope | null) => string | null;
  setTenantChangePending: Dispatch<SetStateAction<boolean>>;
  verifiedTenantSlugRef: MutableRefObject<string | null>;
  setMessage: Dispatch<SetStateAction<string>>;
  initialMessageForList: (saved: OfflineManifestEnvelope[]) => string;
  listRef: MutableRefObject<OfflineManifestEnvelope[] | null>;
  setVerifiedTenantRevision: Dispatch<SetStateAction<number>>;
}) {
  return useCallback(
    (currentShopSlug: string) => {
      setTenantChangePending(false);
      verifiedTenantSlugRef.current = currentShopSlug;
      if (tripId) {
        const visibleEnvelope = envelope?.snapshot.shop.slug === currentShopSlug ? envelope : null;
        const noteMessage = tripNoticeForEnvelope(visibleEnvelope);
        setMessage(
          noteMessage === null || noteMessage.length > 0
            ? ""
            : visibleEnvelope
              ? t("shared.offlineManifest.reconcile.ready")
              : "",
        );
      } else {
        setMessage(initialMessageForList(listRef.current ?? []));
      }
      setVerifiedTenantRevision((revision) => revision + 1);
    },
    [
      envelope,
      t,
      tripId,
      tripNoticeForEnvelope,
      setTenantChangePending,
      verifiedTenantSlugRef,
      setMessage,
      initialMessageForList,
      listRef,
      setVerifiedTenantRevision,
    ],
  );
}

export function useSavedManifest(t: OfflineManifestTranslator) {
  const searchParams = useSearchParams();
  const tripId = useMemo(() => searchParams.get("trip") ?? "", [searchParams]);
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
  const lastTripSyncRef = useRef<TripSyncResult | null>(null);
  const selectedTripStorageRef = useRef<SelectedTripStorageState>(createSelectedTripStorageState());
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
  const { tripPurgedRef, onTripPurged } = useSelectedTripPurgeState(
    setMessage,
    setStoreRead,
    setStoreReadFailed,
  );
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

  const { tenantSlugRef, getTenantRound, resolveTenant, invalidateTenantLookup } =
    useOfflineTenant();
  const tripInventoryReadyRef = useSelectedTripInventoryStatus({
    tripId,
    tenantSlugRef,
    verifiedTenantRevision,
    verifiedTenantSlugRef,
    lastTripSyncRef,
    setList,
    setMessage,
    t,
  });

  const handleTenantChanged = useCallback(() => {
    // A 409 is an explicit server assertion that the tenant verified when
    // this sync began is no longer current. Stop showing that tenant's roster
    // and controls immediately, retain its encrypted pending events, and make
    // the cross-shop purge perform a fresh identity lookup.
    invalidateTenantLookup();
    selectedTripStorageRef.current.changeRevision += 1;
    selectedTripStorageRef.current.readRequest += 1;
    tripInventoryReadyRef.current = false;
    verifiedTenantSlugRef.current = null;
    lastTripSyncRef.current = null;
    setTenantChangePending(true);
    setMessage(t("shared.offlineManifest.reconcile.tenantChanged"));
    dispatchSaved({ type: "tenant-changed" });
    setList(null);
    setTenantChangeRevision((revision) => revision + 1);
  }, [t, invalidateTenantLookup, tripInventoryReadyRef]);

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
    const lastSync = lastTripSyncRef.current;
    if (lastSync?.tripId === tripId && lastSync.shopSlug === verifiedTenantSlugRef.current) return;
    const noteMessage = tripNoticeForEnvelope(envelope);
    setMessage(initialTripStatusMessage(noteMessage, true, t));
  }, [tripId, envelope, verifiedTenantRevision, tripNoticeForEnvelope, t, tripPurgedRef]);

  const refreshDiscarded = useCallback(() => {
    readDiscardedOfflineRecords()
      .then(setDiscarded)
      // Best-effort by design: a device whose storage cannot be read has
      // bigger problems, and both branches below already say so on their own.
      .catch(() => {});
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: getTenantRound is stable by contract.
  const reconcileOnce = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    // A foreign pending copy stays on-device; never submit it under the
    // currently verified shop's session.
    const slug = await beginTripSyncAttempt(lastTripSyncRef, resolveTenant, setMessage, t);
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
      const changeRevisionAtSync = selectedTripStorageRef.current.changeRevision,
        next = await syncOfflineManifest(tripId, slug, getTenantRound() ?? undefined);
      if (!next) return;
      // The request may have been answered under the previous session just as
      // the device verified a different tenant. Never paint that response on
      // the now-authorized surface.
      if (tenantSlugRef.current !== slug) return;
      lastTripSyncRef.current = { tripId, shopSlug: slug, envelope: next };
      if (changeRevisionAtSync !== selectedTripStorageRef.current.changeRevision) {
        // A same-tab or other-tab write committed while this request was in
        // flight. Its IndexedDB record is authoritative; reload it instead of
        // painting this response over a newer roll-call or note disposition.
        selectedTripStorageRef.current.reload();
        return;
      }
      dispatchSaved({ type: "loaded", envelope: next });
      // All three queues, not roll call alone: a checklist tap or an arrival
      // waiting to sync is evidence this device is holding, and a count that
      // cannot see it tells a captain they are caught up when they are not.
      const foreignPending = hasForeignPendingManifestChanges(
        listRef.current ?? [],
        verifiedTenantSlugRef.current,
      );
      setMessage(
        reconciledTripMessage(
          next,
          t,
          foreignPending || !selectedTripInventoryIsReady(tripInventoryReadyRef),
        ),
      );
    } catch (error) {
      if (isShopChangedError(error)) {
        handleTenantChanged();
        return;
      }
      if (tenantSlugRef.current !== slug) return;
      setMessage(t("shared.offlineManifest.reconcile.reachError"));
    }
  }, [tripId, t, resolveTenant, tenantSlugRef, handleTenantChanged, tripInventoryReadyRef]);

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
    getTenantRound,
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

  const onTripEnvelopeLoaded = useSelectedTripEnvelopeHandler({
    tripId,
    verifiedTenantSlugRef,
    dispatchSaved,
    setCheckpoint,
    tripNoticeForEnvelope,
    tripPurgedRef,
    setMessage,
    t,
    reconcile,
  });
  const onTripStorageReadStarted = useCallback(() => dispatchSaved({ type: "suppress-notes" }), []);
  const onTenantVerified = useOnTenantVerified({
    envelope,
    t,
    tripId,
    tripNoticeForEnvelope,
    setTenantChangePending,
    verifiedTenantSlugRef,
    setMessage,
    initialMessageForList,
    listRef,
    setVerifiedTenantRevision,
  });

  useCrossShopPurge({
    tripId,
    tenantSlugRef,
    getTenantRound,
    resolveTenant,
    dispatchSaved,
    setList,
    onListPurged,
    onTenantVerified,
    onTripPurged,
    refreshDiscarded,
    tenantChangeRevision,
  });

  useSelectedTripStorage({
    tripId,
    verifiedTenantRevision,
    tripPurgedRef,
    storageStateRef: selectedTripStorageRef,
    onEnvelope: onTripEnvelopeLoaded,
    onReadStarted: onTripStorageReadStarted,
    onOnline: reconcile,
    setMessage,
    t,
    setStoreRead,
    setStoreReadFailed,
    refreshDiscarded,
  });

  useEffect(() => {
    if (tripId) return;
    // A fresh authenticated identity is a fresh attempt to load the device
    // copy, even if the URL and its trip id did not change.
    if (verifiedTenantRevision > 0) setStoreReadFailed(false);
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
  }, [
    reconcileList,
    refreshDiscarded,
    resolveTenant,
    tripId,
    t,
    verifiedTenantRevision,
    initialMessageForList,
    tripPurgedRef,
  ]);

  const acknowledgeDiscarded = (visibleNotices: DiscardedOfflineRecord[]) =>
    acknowledgeDiscardedNotices(visibleNotices, setDiscarded);

  const verifiedTenantSlug = verifiedTenantRevision > 0 ? verifiedTenantSlugRef.current : null;
  const tripNoteLossMessage = selectedTripNoteLossMessage(envelope, verifiedTenantSlug, t);

  return {
    tripId,
    envelope,
    verifiedTenantSlug,
    foreignPendingChanges: foreignPendingTrip(list ?? [], envelope, verifiedTenantSlug),
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
