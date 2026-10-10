"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { HapticsToggle } from "@/components/HapticsToggle";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid } from "@/components/MissingDiversGrid";
import { OfflineShellVersionBanner } from "@/components/OfflineShellVersionBanner";
import { PullToRefresh } from "@/components/PullToRefresh";
import { watchRollCallTouches } from "@/components/roll-call-touch-guard";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SkipLink } from "@/components/SkipLink";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { StatusMark } from "@/components/ui/StatusMark";
import { FIGURE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { ArrivalStatus } from "@/lib/arrival";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import {
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallNoteAllowed,
} from "@/lib/manifests";
import {
  acknowledgeDiscardedOfflineRecords,
  appendOfflineArrival,
  appendOfflineChecklistCheck,
  appendOfflineRollCall,
  type DiscardedOfflineRecord,
  listOfflineManifests,
  loadOfflineManifest,
  OfflineManifestError,
  purgeOfflineManifestsExceptShop,
  readDiscardedOfflineRecords,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  fetchOfflineManifestShopSlug,
  latestOfflineArrival,
  latestOfflineChecklistCheck,
  type OfflineManifestEnvelope,
  type OfflineRollCallResult,
  offlineArrivalEvents,
  pendingOfflineEventCount,
  rejectedOfflineEventCount,
} from "@/lib/offline-manifests";
import { countParticipants, hasNonDivers, joinPassengerSplit } from "@/lib/participant-types";
import type { PreDepartureCheckStatus } from "@/lib/pre-departure-check";
import { OfflineChecklist } from "./offline-manifest/Checklist";
import { OfflineCounter } from "./offline-manifest/Counter";
import { OfflineCrewRollCall } from "./offline-manifest/CrewRollCall";
import type { OfflineTripControls } from "./offline-manifest/controls";
import { OfflineDiverRollCall } from "./offline-manifest/DiverRollCall";
import { OfflineManifestList } from "./offline-manifest/ManifestList";
import { savedCopyReducer } from "./offline-manifest/saved-copy";
import {
  DiscardedRecordsNotice,
  type OfflineStatement,
  offlineRollCallRowId,
  translatorForThisDevice,
} from "./offline-manifest/shared";
import { OfflineTripHeader } from "./offline-manifest/TripHeader";
import { offlineTripView } from "./offline-manifest/trip-view";

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
  // A marker for the tools that photograph this page (`scripts/screenshot.mjs`,
  // issue #2235): set on the document once the store has been read, so a
  // capture waits for the real branch rather than the "Opening…" one below.
  // It changes nothing anyone sees.
  useEffect(() => {
    if (!storeRead) return;
    document.documentElement.dataset.offlineSettled = "";
    return () => {
      delete document.documentElement.dataset.offlineSettled;
    };
  }, [storeRead]);
  /**
   * Unsynced roll call this device threw away at the retention ceiling
   * (`OFFLINE_MANIFEST_PENDING_GRACE_MS`). Read from storage rather than
   * handed over by whatever triggered the delete: it usually happens where
   * there is no screen — the service worker's push refresh, the staff layout's
   * auto-save — so this surface is the first place a human can be told.
   */
  const [discarded, setDiscarded] = useState<DiscardedOfflineRecord[]>([]);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [busyChecklistItem, setBusyChecklistItem] = useState<string | null>(null);
  // Its own busy key, like the checklist's: a counter tap must never appear to
  // disable a diver's roll-call row, and vice versa.
  const [busyArrival, setBusyArrival] = useState<string | null>(null);
  /**
   * The one row whose "aboard" control is currently asking to be confirmed —
   * a booking id or a crew person id, never more than one at a time (ADR
   * 20260815-offline-can-unsay-a-missing-diver).
   *
   * Only a row that reads **not back aboard** ever enters this state. Asserting
   * somebody is back on the boat over a stated missing-diver mark is the one
   * tap on this surface that turns the loudest row the product has into green,
   * and the two controls stack full-width and adjacent on a phone held in a wet
   * hand on a rolling deck. The second tap names the person — a generic "Are
   * you sure?" is the dialog people learn to dismiss without reading — and
   * everything else on this screen stays one tap, including taking the mark
   * back off, which must never be the harder direction.
   */
  const [confirmAboardFor, setConfirmAboardFor] = useState<string | null>(null);
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
  const tripId = useMemo(() => searchParams.get("trip") ?? "", [searchParams]);
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

  /**
   * The server-verified tenant, cached for this mount. The purge effect below
   * refreshes it on load and on every reconnect; this is the cheap read for the
   * call sites that only need to *check* it (a captain tapping Board should not
   * pay for a request).
   */
  const tenantSlugRef = useRef<string | null>(null);
  /**
   * The in-flight lookup, so the purge effect and the branch effect below share
   * one request instead of racing two on every mount and every reconnect
   * (security review, 2026-08-06). The endpoint is now identity-only rather
   * than the whole 48-hour roster (review 20260802, action item 12), so a
   * duplicate costs far less than it did — but the dedupe stays: on a marina
   * connection each of these can sit for the full ten-second timeout, and two
   * of them can disagree, which would have the purge and the reconcile pass
   * acting on two different answers to "which shop is this".
   *
   * The lookup itself now lives in `src/lib/offline-manifests.ts`
   * (`fetchOfflineManifestShopSlug`), shared with the service worker's own
   * flush pass — it asks the same tenant question for the same reason and must
   * not answer it differently (security review, 2026-08-06).
   */
  const tenantLookupRef = useRef<Promise<string | null> | null>(null);

  const refreshDiscarded = useCallback(() => {
    readDiscardedOfflineRecords()
      .then(setDiscarded)
      // Best-effort by design: a device whose storage cannot be read has
      // bigger problems, and both branches below already say so on their own.
      .catch(() => {});
  }, []);

  const resolveTenant = useCallback(async (): Promise<string | null> => {
    if (tenantSlugRef.current) return tenantSlugRef.current;
    tenantLookupRef.current ??= fetchOfflineManifestShopSlug().finally(() => {
      tenantLookupRef.current = null;
    });
    const slug = await tenantLookupRef.current;
    if (slug) tenantSlugRef.current = slug;
    return slug;
  }, []);

  const reconcile = useCallback(async () => {
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
      setMessage(
        rejected > 0
          ? t("shared.offlineManifest.reconcile.pendingRejectedSingle", { count: rejected })
          : pending > 0
            ? t("shared.offlineManifest.reconcile.pendingWaiting", { count: pending })
            : t("shared.offlineManifest.reconcile.allCaughtUp"),
      );
    } catch {
      setMessage(t("shared.offlineManifest.reconcile.reachError"));
    }
  }, [tripId, t, resolveTenant]);

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

  /**
   * SEC-D3 (review 20260802). The cross-shop purge used to run only from
   * `OfflineManifestAutoSave`, which mounts in the *staff shop layout*. A
   * captain who lives on this shell — bookmarks it, opens it at the dock, never
   * navigates into `/shop/**` on that device — therefore never ran one, so a
   * shared or reassigned boat tablet kept the previous shop's roster
   * decryptable indefinitely.
   *
   * Deliberately its **own** effect rather than a step inside the list branch
   * below: the URL a captain actually bookmarks is the one the list links to,
   * `?trip=<id>`, and the one `manifest-sw.js` replays after a failed reload —
   * so a purge that ran only on the list branch would miss exactly the person
   * SEC-D3 is about (security review, 2026-08-06). Runs on both branches, and
   * again on every reconnect.
   *
   * It never blocks a render. The purge needs a server round trip to learn
   * which tenant this browser is signed in as, and on a marina connection that
   * can take as long as `fetchCurrentShopSlug`'s timeout allows — a captain
   * opening the roll call must never wait on it, which is the entire premise of
   * this surface. What SEC-D3 shortens is how *long* a foreign roster stays
   * decryptable, not the moment it stops being on screen.
   */
  useEffect(() => {
    let cancelled = false;
    const purge = async () => {
      // Re-verified each round rather than read from the cache: a reconnect is
      // exactly when the signed-in shop may have changed, which is the event
      // this whole mechanism exists for.
      tenantSlugRef.current = null;
      const slug = await resolveTenant();
      if (cancelled || !slug) return;
      try {
        await purgeOfflineManifestsExceptShop(slug);
      } catch {
        // Best-effort, unlike the auto-save path, which fails its whole round
        // when the purge throws. There the alternative is writing a second
        // shop's rosters in beside the first; here the alternative is blanking
        // the list a captain is standing on the dock reading. Residency is
        // shortened when this succeeds and unchanged when it does not.
        return;
      }
      if (cancelled) return;
      // Re-read so a record the purge removed stops being displayed in this
      // round rather than at the next visit.
      //
      // **Both branches repaint, and the trip branch says why** (security
      // review, 2026-08-06, F5). This used to re-read only the list — the
      // `current === null ? current : saved` guard below is what confined it to
      // that branch — so on `?trip=<id>` the component kept rendering the
      // in-memory envelope of a record that no longer existed, and every Board
      // / Not-boarded button then raised `OfflineManifestError("unavailable")`:
      // a roster that looks fine at the dock, with dead buttons and a refusal
      // that explains nothing.
      //
      // The asymmetry was deliberate once — blanking the screen a captain is
      // actively reading is its own harm, which is why only the list, where a
      // vanished row costs a link rather than the working surface, repainted.
      // It does not survive what the record actually is. The cross-shop purge
      // can only delete a record belonging to a *different* shop than the
      // session this tablet now holds, so what stays on screen is another
      // shop's diver names, emergency contacts and readiness/medical blockers,
      // rendered with no session behind them — the exact exposure the purge
      // exists to end. And nothing on it can be acted on any more: a roster
      // that cannot record is worse than no roster, because it reads as a head
      // count being kept. Keeping it up would trade an ongoing disclosure for a
      // convenience the buttons can no longer deliver.
      //
      // So it repaints — but never to a bare "nothing saved on this phone",
      // which is the one thing the captain already knows is wrong. The empty
      // state names the cause: a different shop is signed in on this tablet.
      // Two things it will not do: blank on a *failed* read (only a store that
      // positively answers "gone" repaints), and blank a record that survived
      // the purge because it still holds unsynced evidence.
      //
      // All this round reports is what it found: gone, under this tenant. It
      // deliberately does not decide whether anything was *lost*, or what to
      // say about it — that needs the record this view is showing, and an
      // async callback cannot see React state. It used to bridge that with a
      // ref mirroring `envelope`, which lags its own commit and made the
      // repaint droppable in two different orderings; `savedCopyReducer` now
      // joins the two halves in whichever order they arrive. Read its doc
      // before changing this line.
      if (tripId) {
        const held = await loadOfflineManifest(tripId).catch(() => undefined);
        if (!cancelled && held === null) dispatchSaved({ type: "gone", tenant: slug });
      } else {
        await listOfflineManifests()
          .then((saved) => {
            if (!cancelled) setList((current) => (current === null ? current : saved));
          })
          // A failed refresh keeps the list we already rendered — stale beats
          // blank on a dock tablet; the next purge round retries anyway.
          .catch(() => {});
      }
      // A purge round is also when the store is most likely to have hit the
      // retention ceiling and thrown unsynced roll call away, so ask what was
      // lost right after it rather than only at mount.
      if (!cancelled) refreshDiscarded();
    };
    void purge();
    window.addEventListener("online", purge);
    return () => {
      cancelled = true;
      window.removeEventListener("online", purge);
    };
    // No `t` any more: this round reports a fact and picks no words, so a
    // translator identity can no longer cancel a repaint mid-flight by
    // re-running the effect underneath it.
  }, [refreshDiscarded, resolveTenant, tripId]);

  useEffect(() => {
    if (!tripId) {
      // No specific trip requested — this is the dive.day-root/shell landing
      // page (see ADR 20260726-shopwide-offline-manifest-priming), so list
      // whatever this device already has rather than asking for a trip id.
      const showList = (saved: OfflineManifestEnvelope[]) => {
        setList(saved);
        setMessage(
          saved.length > 0
            ? t("shared.offlineManifest.reconcile.savedCount", { count: saved.length })
            : t("shared.offlineManifest.reconcile.noneSavedYet"),
        );
      };

      const refreshList = () =>
        listOfflineManifests()
          .then(async (saved) => {
            // Paint from storage alone, before anything touches the network —
            // the whole premise of this surface. The cross-shop purge runs in
            // its own effect above and repaints if it removes anything.
            showList(saved);
            setStoreRead(true);
            void reconcileList(saved, await resolveTenant());
          })
          .catch(() => setMessage(t("shared.offlineManifest.reconcile.listLoadError")))
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
      .catch(() => setMessage(t("shared.offlineManifest.reconcile.singleLoadError")))
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
  const discardNotice = (
    <DiscardedRecordsNotice t={t} records={discarded} onAcknowledge={acknowledgeDiscarded} />
  );

  // Before the store has been read — which includes every server render, since
  // the effect above only runs in the browser — say what is actually true and
  // nothing more. See `storeRead` above for why this branch sits ahead of the
  // `tripId` split rather than inside either side of it: it must not depend on
  // the URL, because the cached shell is one document replayed for all of them.
  if (!storeRead) {
    return (
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <ShopPageHeader
          eyebrow={t("shared.offlineManifest.single.eyebrow")}
          title={t("shared.offlineManifest.openingHeading")}
          meta={
            <p className="text-muted" role="status" aria-live="polite">
              {message}
            </p>
          }
        />
      </main>
    );
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
    // "Nothing saved on this phone yet" is a claim about this device having
    // never held a copy. When the cross-shop purge has just taken one away
    // mid-read (see the purge effect), that sentence is the one thing the
    // captain already knows is false — so this branch names the real cause
    // instead, and offers the only advice that is true for a record belonging
    // to someone else's shop. `removedForOtherShop === null` means nothing was
    // lost at all: a `?trip=` this device simply never saved, which is exactly
    // what the plain empty state is for.
    return (
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        {discardNotice}
        <ShopPageHeader
          eyebrow={t("shared.offlineManifest.single.eyebrow")}
          title={
            removedForOtherShop
              ? t("shared.offlineManifest.single.removedOtherShopHeading")
              : t("shared.offlineManifest.single.emptyHeading")
          }
          meta={
            <p className="text-muted" role="status">
              {removedForOtherShop === null
                ? message
                : removedForOtherShop
                  ? t("shared.offlineManifest.single.removedOtherShopMessage")
                  : t("shared.offlineManifest.reconcile.noneForTrip")}
            </p>
          }
        />
        <div className="mt-6 rounded-panel border border-border bg-surface-sunken p-8 text-center sm:p-10">
          <div
            className="mx-auto grid size-12 place-items-center rounded-inset bg-surface text-2xl"
            aria-hidden="true"
          >
            <DiveDayIcon name="empty" className="size-5 text-primary" />
          </div>
          <p className="mx-auto mt-4 max-w-md text-muted">
            {removedForOtherShop
              ? t("shared.offlineManifest.single.removedOtherShopHint")
              : t("shared.offlineManifest.single.emptyHint")}
          </p>
        </div>
      </main>
    );
  }

  const view = offlineTripView(envelope, checkpoint);
  if (!view) return null;
  const {
    manifest,
    isDeparture,
    expired,
    boarded,
    awaiting,
    rollCallComplete,
    totalDivers,
    allBoarded,
    missingDivers,
    anyBuddies,
  } = view;
  const passengerTypes = countParticipants(manifest.divers);

  /**
   * Queue one result on this device, for a diver or a crew member. One
   * function, because everything a captain relies on here — the expiry stop
   * rule, the refusal wording, the immediate reconcile attempt — is the same
   * act on the same screen; only the subject differs, and it is passed
   * straight through to `appendOfflineRollCall`, which reads it exactly once
   * (`offlineRollCallSubject`).
   *
   * The busy key is whichever id was named: booking ids and person ids are
   * both uuids from disjoint tables, so one map of "which row is saving" is
   * unambiguous.
   */
  async function record(
    subject: { bookingId: string } | { crewPersonId: string },
    statement: OfflineStatement,
    /**
     * What stands at this row right now, so the device applies the *same*
     * rule the server does (`rollCallNoteAllowed`). Without it the shared
     * per-row draft would ride whichever control was tapped, including an
     * ordinary "aboard" — one surface writing observations onto the safety
     * trail that the other refuses is the divergence issue #1058 was
     * reacting to.
     */
    standing?: Pick<OfflineRollCallResult, "state" | "implied">,
  ) {
    // Whatever this tap turns out to be, no confirmation is left armed behind
    // it — including the refusals below, which end the act just as finally as a
    // write does.
    setConfirmAboardFor(null);
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    const subjectId = "bookingId" in subject ? subject.bookingId : subject.crewPersonId;
    const sentNote = rollCallNoteAllowed(checkpoint, statement.status, standing)
      ? noteDrafts[subjectId]?.trim() || undefined
      : undefined;
    setBusyBooking(subjectId);
    try {
      const next = await appendOfflineRollCall(tripId, {
        ...subject,
        ...statement,
        checkpoint,
        // The sentence rides the same queued event as the mark, so there is no
        // second write to lose offshore.
        note: sentNote,
      });
      // Cleared **only if it went**. A draft the rule refused stays in the box
      // rather than vanishing on a tap that did not carry it.
      if (sentNote) {
        setNoteDrafts((drafts) => {
          if (!(subjectId in drafts)) return drafts;
          const { [subjectId]: _sent, ...rest } = drafts;
          return rest;
        });
      }
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      if (navigator.onLine) await reconcile();
    } catch (error) {
      if (error instanceof OfflineManifestError) {
        setMessage(
          error.code === "expired"
            ? t("shared.offlineManifest.single.record.expiredCannotRecord")
            : error.code === "not_allowed"
              ? t("shared.offlineManifest.single.record.notAllowed")
              : t("shared.offlineManifest.single.record.unavailable"),
        );
      } else {
        setMessage(t("shared.offlineManifest.single.record.genericError"));
      }
    } finally {
      setBusyBooking(null);
    }
  }

  /**
   * The checklist's own tap, sibling to `record` above and deliberately
   * simpler: no checkpoint, no confirm-before-unsaying dialog (nothing here
   * is the missing-diver alarm that dialog exists to protect — see
   * `pre-departure-check.ts`), and its own busy key so a checklist tap can
   * never appear to disable a diver's row or vice versa.
   */
  async function recordChecklistCheck(checklistItemId: string, status: PreDepartureCheckStatus) {
    // Only ever invoked from the JSX below, which is itself gated on
    // `envelope` — this is the same guard shape as the `!envelope` early
    // return above, restated because a nested function declaration doesn't
    // inherit that narrowing across the closure boundary.
    if (!envelope) return;
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    setBusyChecklistItem(checklistItemId);
    try {
      const next = await appendOfflineChecklistCheck(tripId, {
        checklistItemId,
        status,
        note: null,
        retractsClientEventId:
          status === "cleared"
            ? latestOfflineChecklistCheck(
                envelope.snapshot,
                checklistItemId,
                envelope.checklistEvents,
              )?.clientEventId
            : undefined,
      });
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      if (navigator.onLine) await reconcile();
    } catch (error) {
      if (error instanceof OfflineManifestError) {
        setMessage(
          error.code === "expired"
            ? t("shared.offlineManifest.single.record.expiredCannotRecord")
            : error.code === "not_allowed"
              ? t("shared.offlineManifest.single.record.notAllowed")
              : t("shared.offlineManifest.single.record.unavailable"),
        );
      } else {
        setMessage(t("shared.offlineManifest.single.record.genericError"));
      }
    } finally {
      setBusyChecklistItem(null);
    }
  }

  /**
   * The counter's own tap (ADR 20260907-the-counter-survives-offline).
   *
   * Sibling to `record` and `recordChecklistCheck`, and it will never grow
   * into either: an arrival says a diver reached the desk, and there is no
   * status here that can say one is on the boat. `appendOfflineArrival` writes
   * to its own queue, which the sync route hands to the same two functions the
   * live counter calls.
   */
  async function recordArrival(bookingId: string, status: ArrivalStatus) {
    if (!envelope) return;
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    setBusyArrival(bookingId);
    try {
      const next = await appendOfflineArrival(tripId, {
        bookingId,
        status,
        retractsClientEventId:
          status === "cleared"
            ? latestOfflineArrival(envelope.snapshot, bookingId, offlineArrivalEvents(envelope))
                ?.clientEventId
            : undefined,
      });
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      if (navigator.onLine) await reconcile();
    } catch (error) {
      if (error instanceof OfflineManifestError) {
        setMessage(
          error.code === "expired"
            ? t("shared.offlineManifest.single.record.expiredCannotRecord")
            : error.code === "not_allowed"
              ? t("shared.offlineManifest.single.record.notAllowed")
              : t("shared.offlineManifest.single.record.unavailable"),
        );
      } else {
        setMessage(t("shared.offlineManifest.single.record.genericError"));
      }
    } finally {
      setBusyArrival(null);
    }
  }

  const controls: OfflineTripControls = {
    t,
    locale,
    message,
    setCheckpoint,
    busyBooking,
    busyChecklistItem,
    busyArrival,
    confirmAboardFor,
    setConfirmAboardFor,
    noteDrafts,
    setNoteDrafts,
    record,
    recordChecklistCheck,
    recordArrival,
  };

  return (
    <main
      data-roll-call-surface
      className="boat-mode mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6"
    >
      <PullToRefresh onRefresh={reconcile}>
        <OfflineShellVersionBanner copy={shellVersionCopy} />
        {discardNotice}
        <SkipLink
          href="#offline-roll-call"
          label={t("shared.offlineManifest.single.skipLink")}
          level="page"
        />
        <OfflineTripHeader view={view} controls={controls} />

        {/* **Above the roster, deliberately.** This is the one document a crew has
          with no signal, and the numbers on it are the ones you reach for while
          somebody is bent — not after the boat is back. Everything below is who
          is aboard; this is what to do about it. Rides in the snapshot, so it is
          here in airplane mode (issue #688). */}
        <EmergencyReferenceCard
          className="mt-6"
          // A snapshot saved before this field existed still decrypts, so it
          // arrives without one. Falls back to the empty reference, which renders
          // the "nothing recorded yet" prompt — the same thing a shop that has
          // filled nothing in sees, and the only outcome that does not throw on
          // the one surface a crew has offshore.
          reference={envelope.snapshot.shop.emergencyReference ?? EMPTY_EMERGENCY_REFERENCE}
          copy={{
            heading: t("manifest.emergency.heading"),
            empty: t("manifest.emergency.empty"),
            vesselLabel: t("manifest.emergency.vesselLabel"),
            shoreContactLabel: t("manifest.emergency.shoreContactLabel"),
            planLabel: t("manifest.emergency.planLabel"),
          }}
        />

        {/* Opt-in by presence, the same rule the gear register follows: a shop
          with no checklist items renders nothing here, not an empty card.
          Above the checkpoint switcher because the check happens once,
          before the boat leaves — not once per checkpoint. */}
        {/* The hull's papers and safety kit as the live Boat tab said them at
          the save, above the boat check for the same reason the live page
          puts them there. Words, not codes: nothing here can word them. */}
        {envelope.snapshot.boatSafety ? (
          <BoatSafetyNotices className="mt-6" {...envelope.snapshot.boatSafety} />
        ) : null}
        <OfflineChecklist view={view} controls={controls} />

        {/* **The desk, with no signal** (ADR
          20260907-the-counter-survives-offline). Above the checkpoint switcher
          for the same reason the checklist is: arriving happens once, before
          the boat leaves, not once per dive. It is deliberately a separate
          list from the roll call below rather than a second control on those
          rows — arrived and aboard are two different questions asked in two
          different places, and a row that answered both would be the first
          step toward a queue answering the second. */}
        <OfflineCounter view={view} controls={controls} />

        {/* `max-sm:[&>*]:grow`, the rule `ShopPageHeader` gives its doors: on
            a phone each wrapped row of checkpoints fills as one band, rather
            than leaving "After dive 2" alone and short on a row of its own. */}
        <nav
          className="mt-6 flex flex-wrap items-center gap-3 pb-1 max-sm:[&>*]:grow"
          aria-label={t("shared.offlineManifest.single.checkpointNavAria")}
        >
          {rollCallCheckpoints(manifest.trip.plannedDives).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                // A pending confirmation belongs to the row *and the checkpoint*
                // it was raised on; carrying it across would leave a "Confirm
                // Maya is aboard" armed on a different head count.
                setConfirmAboardFor(null);
                setCheckpoint(value);
              }}
              className={buttonClass({
                variant: value === checkpoint ? "primary" : "secondary",
                size: "boat",
                className: "shrink-0",
              })}
            >
              {rollCallCheckpointText(t, value)}
            </button>
          ))}
        </nav>

        {/* One look, complete or not: no coral on a roll call (ADR
            20260901-diveday-reimagined's coral table), offline exactly as on
            the live panel — a crew that loses signal between two dives must not
            see two different completions for one fact. The heading below says
            it in words. */}
        {/* **The label fits its tile, or wraps inside it; it never spills
            into the next.** Uppercase, "EMBARCADOS" needed 86px where a `p-3`
            tile leaves 75 at 360. Narrowing the tiles' inset
            below `sm` fixed only the 360 case and left every phone's tiles
            reading cramped, 7px from their borders beside panels inset 16-20.
            In sentence case the words fit a `p-3` tile at 14px (`text-sm`: the
            counts are safety reading, never 12px muted), and anything longer
            hyphenates in the page's language (`lang`) or, where the browser
            has no dictionary, breaks inside the tile. The gap stays 8px
            below `sm`: three tiles on a phone. */}
        <section className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            [t("shared.offlineManifest.single.statsDivers"), manifest.summary.totalDivers],
            [t("shared.offlineManifest.single.statsBoarded"), boarded],
            [t("shared.offlineManifest.single.statsAwaiting"), awaiting],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
              <p
                lang={locale}
                className="text-sm font-semibold text-muted hyphens-auto wrap-break-word"
              >
                {label}
              </p>
              <p className={`mt-1 ${FIGURE_CLASS}`}>{value}</p>
            </div>
          ))}
        </section>
        {/* Who the passengers are, when they are not all divers (ADR
            20261007-participant-types): read from the saved rows themselves,
            so a copy saved before the summary carried the split still says it. */}
        {hasNonDivers(passengerTypes) ? (
          <p className="mt-2 text-sm text-muted tabular-nums">
            {joinPassengerSplit(passengerTypes, (type, count) =>
              type === "diver"
                ? t("manifest.passengerDivers", { count })
                : type === "snorkeler"
                  ? t("manifest.passengerSnorkelers", { count })
                  : t("manifest.passengerRiders", { count }),
            )}
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className={`flex items-center gap-2 ${SUB_TITLE_CLASS}`}>
            {rollCallComplete ? <StatusMark variant="success" size="md" /> : null}
            <span>
              {rollCallComplete
                ? t("shared.offlineManifest.single.rollCallCompleteHeading")
                : t("shared.offlineManifest.single.checkpointRollCallHeading", {
                    checkpoint: rollCallCheckpointText(t, checkpoint),
                  })}
            </span>
          </h2>
          {rollCallComplete ? (
            <p className="mt-1 text-sm font-semibold text-muted" role="status" aria-live="polite">
              {boarded === manifest.summary.totalDivers
                ? t("shared.offlineManifest.single.allAboard")
                : t("shared.offlineManifest.single.someNotBoarded", {
                    count: manifest.summary.totalDivers - boarded,
                  })}
            </p>
          ) : null}
          {/*
           * The crew half of the head count — **recordable here**, since H-46.
           * Divers could always be counted with the radio off and crew could
           * not, which meant an after-dive checkpoint could never be closed at
           * sea: `rollCallCompleteness` needs both halves, and the after-dive
           * checkpoint is the one where a person may still be in the water.
           *
           * The only copy that still cannot record it is one saved before crew
           * ids rode along, whose crew have no subject to write an event
           * against. That says so in as many words below, and stays fail-closed
           * either way: the checkpoint reads open here exactly as it does
           * online, never the reverse.
           */}
          {/* **A panel's inset for the words, and the roster flush.** The box
            pads its heading and status like every panel in this column
            (`p-4 sm:p-5`), and its roster is the diver roll call's own ruled
            list laid edge to edge inside it, the shape the live crew list
            already has (`CrewRollCall`). The rows were `px-3` cards inside a
            `p-3` box, so their controls ended 5–9px inside the diver controls
            below them. `overflow-hidden` rounds the last row's fill into the
            box's corner; every control in a row sits a whole padding clear of
            that edge, so no focus ring reaches it. A `section` named by its
            heading, as the counter's is.

            **No inset ring on the missing box.** An inset ring paints under
            the box's children, and the flush roster covers it, so it ringed
            the heading and stopped where the list began. The ring belongs to
            the missing person's own row (`ROLL_CALL_ROW_TONE.notBackAboard`),
            as on every roll-call row; the box keeps its danger border, fill
            and heading.

            **A surface box while crew are still being called**, as the live
            crew list sits in a surface card. The rows wear the roll call's
            awaiting tone, a sunken fill, and on a sunken box an uncalled crew
            member matched the ground behind them, marked only by a grey rule
            and hairlines: the row a captain is looking for, read at the rail
            in sun, with the weakest fill on the page. The dock copy's earlier
            crew cards kept "awaiting" raised for that reason (dive-domain
            review, 20260804); the contrast is kept here the other way round.
            The settled and missing boxes keep their success and danger
            fills. */}
          <OfflineCrewRollCall view={view} controls={controls} />
          {/* Buddy teams are display-only on the dock copy, and the split-team
            read ("someone back, someone not") belongs to the live roll call
            alone — a snapshot cannot know who came back (ADR
            20260804-buddy-teams). Stated the same neutral way as the crew
            limitation above: a limitation of this copy, not an alarm. */}
          {anyBuddies ? (
            <p className="mt-3 text-sm font-semibold text-pretty text-muted">
              {t("shared.offlineManifest.single.buddyReadOnlyHere")}
            </p>
          ) : null}
          <OfflineDiverRollCall view={view} controls={controls} />
        </section>

        {/* Same words as the live page, chosen by the same checkpoint rule: at
          the dock these are people still to board, after a dive they are
          people nobody has counted back aboard yet. The dock copy must never
          be louder than the live manifest about a benign state.

          **The grid stays here, and only here** (decision 20260812, closing
          FU-20260810-offline-manifest-checklist-grammar). The live manifest
          dropped its face grid, and then the name chips that replaced it,
          because the roll-call rows directly below already name everyone
          (Aaron, 2026-10-05).

          The grid is also a scanning surface rather than a jump list, and this
          is the copy read underway, at the rail, looking up from the water for
          a face rather than down at a name. Its rents-kit line carries
          information no chip does. Keeping it is a considered divergence
          from the live page, not a leftover: the *rows* above now read
          identically on both surfaces, which is what a captain working the two
          minutes apart actually needs.

          The blocked accent is **not** part of that divergence — it follows
          the live chip's checkpoint rule below. The one thing that does stay
          ungated is the diver row's own readiness badge, for the reason
          written above it: that badge is the snapshot's two-state record, not
          an exception accent on a checkpoint-scoped prompt. */}
        <MissingDiversGrid
          divers={missingDivers.map((diver) => ({
            bookingId: diver.bookingId,
            fullName: diver.fullName,
            // Where the tap lands, from the same function that wrote the id
            // onto the row above (#1675). Every face here is a diver from the
            // roster rendered above, so the target is on the page by
            // construction, not by hope.
            rowId: offlineRollCallRowId(diver.bookingId),
            rentsKit: diver.rentalFit.state === "rents",
            // A readiness fact, and only at the dock — the same gate the live
            // chip this grid stands in for applies (`blocked: diver.blocked &&
            // isDeparture`, SummaryPanel). Every face here is somebody nobody
            // has called yet, so after a dive every one of them is somebody who
            // went in the water: the saved paperwork word is stale by
            // definition there, and its red competed with the one red on the
            // page that means a diver has not come back. The live row states
            // the same rule in the same words (`blockedAtDock`, DiverRollCall),
            // and this page's own head-count note says it of itself
            // (`isDeparture`, above) — the grid was the one place that said it
            // and then rendered the word anyway.
            blocked: isDeparture && diver.readiness.status === "blocked",
          }))}
          tone={isDeparture ? "neutral" : "urgent"}
          copy={{
            heading: isDeparture
              ? t("manifest.stillToBoardHeading", { count: missingDivers.length })
              : t("manifest.notCountedBackHeading", { count: missingDivers.length }),
            statusLabel: isDeparture
              ? t("manifest.missingDiversPillDock")
              : t("manifest.missingDiversPillAfterDive"),
            tapHint: t("manifest.missingDiversTapHint"),
            rentsKitLabel: t("manifest.rentsKitLabel"),
            ownKitLabel: t("manifest.ownKitLabel"),
            // The offline exception, all the way down: the diver's own row
            // reads "Blocked when saved", so the face in this grid has to say
            // the same thing. The bare readiness word here made the glossary's
            // "every readiness word on this page carries the qualifier"
            // sentence false, and put an unqualified badge one scroll from a
            // qualified one on a page whose whole point is that it may be
            // stale (#1360).
            blockedLabel: t("shared.offlineManifest.single.blockedBadge"),
          }}
        />

        {/* Per-device controls are secondary to roll call. Keep them in the
          same disclosure on the offline surface as the live manifest's
          "On this phone" group, rather than mixing one toggle into the
          checkpoint selector. The haptics toggle renders nothing on a phone
          with no vibration motor, and then the group has nothing in it, so
          it hides rather than opening onto an empty box. */}
        <section
          className="mt-8 border-t border-border pt-5 print:hidden has-[[data-phone-prefs]:empty]:hidden"
          aria-labelledby="offline-phone-heading"
        >
          <details id="offline-phone-settings" className="group/offline-phone">
            <summary className="group/summary flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-surface-sunken/70 focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden">
              <DisclosureCaret className="group-open/offline-phone:rotate-90" />
              <h2
                id="offline-phone-heading"
                className="text-base font-semibold group-hover/summary:underline"
              >
                {t("manifest.onThisPhone")}
              </h2>
            </summary>
            <div data-phone-prefs className="grid gap-3 pt-4 sm:grid-cols-2">
              {/* Renders nothing on a phone with no vibration motor — which is
                every iPhone (src/components/haptics.ts). */}
              <HapticsToggle
                copy={{ label: t("shared.haptics.toggleLabel") }}
                className="h-full w-full justify-start"
              />
            </div>
          </details>
        </section>

        <footer className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-5">
          <a
            href={`/shop/${envelope.snapshot.shop.slug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`}
            className={buttonClass({
              size: "boat",
              className: "w-full sm:w-auto",
            })}
          >
            {t("shared.offlineManifest.single.openLiveManifest")}
          </a>
        </footer>

        {/*
         * Dive-domain-expert review (task 72, invariant 3): none of these three
         * react to an attempted board/not-board tap — only to the envelope's
         * own boarded/awaiting counts, which cannot change while `expired` is
         * true (record() above refuses before ever calling
         * appendOfflineRollCall). So an expired copy — where no board/not-board
         * buttons render at all — never fires a haptic or the ripple for an
         * action the store was about to reject; there's no action for it to be
         * attempted for. MilestoneHaptics and SubSurfaceRipple both skip their
         * very first render besides (see their own components), so mounting
         * with an already-complete roll call never fires either on load.
         *
         * Invariant 5: the ripple and haptics are a same-device UI reaction,
         * not a claim that the server has confirmed anything — pending/rejected
         * counts stay visible in the header above regardless, and sync
         * reconciliation (reconcile(), above) remains the only thing that ever
         * changes `syncStatus`.
         */}
        <MilestoneHaptics total={totalDivers} boarded={boarded} />
        {/*
         * Gated on `allBoarded` (the true boarded count), not `rollCallComplete`
         * (awaiting === 0) — task 72, invariant 4. A checkpoint with a
         * carried-forward not-boarded diver reaches awaiting === 0 without
         * everyone being aboard; the celebration must not read as "everyone's
         * aboard" for that manifest.
         */}
        <SubSurfaceRipple
          complete={allBoarded}
          copy={{
            iconTitle: t("shared.subSurfaceRipple.iconTitle"),
            message: t("shared.subSurfaceRipple.message"),
          }}
        />
      </PullToRefresh>
    </main>
  );
}
