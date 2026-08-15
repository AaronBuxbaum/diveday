"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AmbientContrastControl, AmbientGlareDetector } from "@/components/AmbientGlareDetector";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { MilestoneHaptics } from "@/components/MilestoneHaptics";
import { MissingDiversGrid } from "@/components/MissingDiversGrid";
import { OfflineFreshnessPill } from "@/components/OfflineFreshnessPill";
import { OfflineShellVersionBanner } from "@/components/OfflineShellVersionBanner";
import { OFFLINE_CREW_ROW_TONE, ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SkipLink } from "@/components/SkipLink";
import { SubSurfaceRipple } from "@/components/SubSurfaceRipple";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass } from "@/components/ui/form";
import { WaterLocker, WaterLockerToggle } from "@/components/WaterLocker";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import { matchLocale } from "@/i18n/negotiate";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { cachedFormatter, cachedListFormat } from "@/lib/intl-cache";
import {
  isNotBackAboard,
  isRollCallCheckpoint,
  type RollCallCheckpoint,
  rollCallCheckpoints,
  rollCallCompleteness,
  rollCallLabel,
  rollCallRecordedTone,
  rollCallRowState,
} from "@/lib/manifests";
import {
  acknowledgeDiscardedOfflineRecords,
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
  isOfflineManifestExpired,
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineManifestEnvelope,
  type OfflineRollCallEvent,
  type OfflineRollCallResult,
  offlineManifestFreshness,
} from "@/lib/offline-manifests";

/**
 * The device's own language. This is the one surface that cannot use
 * `requestLocale` (src/i18n/request.ts): it renders from an encrypted snapshot
 * in IndexedDB with the radio off, so there is no request and no
 * `Accept-Language` header to negotiate from. Both call sites run after the
 * snapshot has loaded from storage, so `navigator` is always defined by then —
 * the guard is for safety, not for a real server render.
 */
/**
 * The dock target, built from the same wrapper the live manifest's roll-call
 * buttons use — `w-full` on a phone, auto-width beside the row from `sm` up.
 *
 * This was a copied literal, and the comment justifying the copy was wrong:
 * it said the constant lived under `src/app`, which `src/components` may not
 * import (`pnpm check:architecture`) — true of that constant, but the thing it
 * was a copy *of* is `buttonClass`, which lives in `src/components/ui/` and
 * was already imported into this file. The two literals had drifted apart on
 * padding, press scale and disabled opacity, and neither carried the
 * `cursor-pointer` that Tailwind v4's Preflight removed from `<button>`.
 */
const OFFLINE_BOAT_TARGET_CLASS = buttonClass({
  variant: "bare",
  size: "boat",
  busy: true,
  className: "w-full sm:w-auto",
});

function deviceLocale(): string | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.language;
}

/**
 * `staffTranslator` (src/i18n/staff-messages.ts) is documented as
 * server-side-only for every other staff surface — its words normally reach a
 * Client Component as a `copy` prop built by a Server Component parent, never
 * as a function crossing that boundary. This view has no such parent request:
 * it renders fully offline from an IndexedDB snapshot (see `deviceLocale`
 * above), so there is no per-request `Accept-Language` header to negotiate
 * from server-side. `staffTranslator` itself has no server-only dependency —
 * it is a plain function over a JSON bundle — so it is called directly here,
 * entirely within this client module, rather than crossing the RSC boundary
 * (which is the thing that's actually unsafe). `matchLocale` gives it the
 * same fuzzy `es-MX` → `es-ES` matching every other surface gets, instead of
 * the exact-tag-only fallback `staffTranslator` uses on its own.
 */
function offlineManifestTranslator() {
  const requested = deviceLocale();
  const resolved: DiverLocale = requested
    ? (matchLocale([{ tag: requested, quality: 1 }]) ?? DEFAULT_DIVER_LOCALE)
    : DEFAULT_DIVER_LOCALE;
  return { t: staffTranslator(resolved), locale: resolved };
}

/**
 * The saved copy this view is showing on `?trip=<id>`, and what happened to it.
 *
 * A reducer, and not three `useState`s, for one reason: **"the store says this
 * record is gone" and "whose record was it" are answered in different places
 * and can arrive in either order**, and the wrong answer to the second one is a
 * disclosure. The purge round below learns the first from an async callback,
 * which cannot see React state; the second can only be read from state. Before
 * this, the round bridged that gap by reading a ref mirroring `envelope`,
 * written from an effect — and a mirror written from an effect lags its own
 * commit, so the round's `null` read did not *defer* the repaint, it skipped it:
 *
 * - Between a commit and its passive effects the mirror is stale. The purge's
 *   read landed there often enough to be a measured CI flake.
 * - Worse on a real tablet, where the tenant lookup is a warm request and the
 *   store is a cold IndexedDB open plus an AES-GCM decrypt: an entire purge
 *   round — delete included — can finish before `?trip=<id>`'s opening read has
 *   resolved at all. Nothing has painted, so the mirror is honestly `null`, and
 *   the read already in flight then paints the record the purge just deleted.
 *   Another shop's divers, emergency contacts and readiness blockers, on a
 *   tablet signed in as someone else, with Board buttons that can only throw —
 *   the F5 disclosure the repaint exists to end, restored one microtask later.
 *
 * Both orderings are the same defect, and a reducer removes it rather than
 * narrowing it: whichever half arrives second is applied to the half already
 * held, in one transition, against the state React actually has. The invariant
 * it keeps is the whole point — **once `goneUnderTenant` is set, `envelope` is
 * `null` and stays `null`** — so no read that was in flight when the record was
 * deleted can put it back on screen.
 *
 * That latch is per **mount**, and safely so: this shell is one trip per mount.
 * The list links to `?trip=<id>` with a plain `<a href>`, and `manifest-sw.js`
 * replays a cached *document*, so both are full loads — `tripId` never changes
 * under a live mount. The `checkpoint` state below already banks the same
 * assumption in its `useState` initialiser. A client-side navigation between
 * two trips would need this state reset with it, exactly as it would need that.
 */
type SavedCopyState = {
  /** The decrypted copy on screen. Cleared the moment the store says it is gone. */
  envelope: OfflineManifestEnvelope | null;
  /**
   * The shop signed in on this device when a purge round positively answered
   * "gone" for this trip. Also the latch that keeps a late read out.
   */
  goneUnderTenant: string | null;
  /**
   * Whose copy vanished: `true` for another shop's, `false` for this shop's own
   * record aging out, `null` for nothing lost — a `?trip=` this device simply
   * never saved reaches the plain empty state, not an accusation.
   */
  removedForOtherShop: boolean | null;
};

/**
 * What one tap queues: a status, plus — on a retraction — the statement it takes
 * back.
 *
 * The two travel together because they are one decision. A `cleared` that does
 * not name its target is a blind newest-wins write against a row that may be
 * "did this diver come back from the dive", and the pair being separable is how
 * one of the four controls below would end up sending the retraction without it.
 */
type OfflineStatement = Pick<OfflineRollCallEvent, "status" | "retractsClientEventId">;

/**
 * What re-tapping a control that already carries its own state should queue: the
 * **retraction**, naming the event being undone, or a fresh statement.
 *
 * One function for all four controls (diver and crew × aboard and not-aboard),
 * so the rule cannot hold on three of them and lapse on the fourth. `active` is
 * "this control is the one showing the current reading" — the caller's own
 * question, since the aboard control asks about `state === "boarded"` and the
 * exception control asks `rollCallRowState`'s `recordedNotBoarded`.
 *
 * Two conditions, and both are load-bearing:
 *
 * - `local` — the reading came from an event **this device queued** (ADR
 *   20260815-offline-can-unsay-a-missing-diver). A snapshot reading is somebody
 *   else's statement, and the row says where to undo it.
 * - `clientEventId` — the id the server compares against before applying the
 *   retraction (ADR 20260815-an-offline-retraction-names-its-target). The two
 *   are dropped together when a retraction of this reading has already been
 *   refused, so a row whose undo cannot succeed stops offering one.
 *
 * With neither, the tap falls through to `otherwise` — a **fresh statement**,
 * not a retraction, and that is the right reading of the state it happens in: a
 * row this device did not record, or one the server has told us belongs to
 * somebody else now. Re-stating "not back aboard" there re-raises the same
 * alarm and holds the count open; re-stating "boarded" is a new sighting by
 * somebody who can see the person. Never a bare `cleared`, which the server
 * would apply blind.
 */
function reTap(
  state: OfflineRollCallResult | undefined,
  active: boolean,
  otherwise: "boarded" | "not_boarded",
): OfflineStatement {
  return active && state?.local && state.clientEventId
    ? { status: "cleared", retractsClientEventId: state.clientEventId }
    : { status: otherwise };
}

type SavedCopyAction =
  | { type: "loaded"; envelope: OfflineManifestEnvelope | null }
  | { type: "gone"; tenant: string };

function savedCopyReducer(state: SavedCopyState, action: SavedCopyAction): SavedCopyState {
  switch (action.type) {
    case "loaded":
      if (state.goneUnderTenant === null) return { ...state, envelope: action.envelope };
      // The store already answered "gone" for this trip, and this read was
      // issued before it did. It is the only thing that can say whose copy was
      // lost, so it names the loss — and is never shown.
      return {
        ...state,
        envelope: null,
        removedForOtherShop:
          action.envelope === null
            ? state.removedForOtherShop
            : action.envelope.snapshot.shop.slug !== state.goneUnderTenant,
      };
    case "gone":
      return {
        envelope: null,
        goneUnderTenant: action.tenant,
        removedForOtherShop:
          state.envelope === null
            ? state.removedForOtherShop
            : state.envelope.snapshot.shop.slug !== action.tenant,
      };
  }
}

export function OfflineManifestView() {
  // Memoized so `reconcile`/`reconcileList` below (and the effect that reruns
  // whenever they change) stay referentially stable across renders — the
  // device's language doesn't change mid-session, so recreating the
  // translator on every render bought nothing except spurious effect reruns.
  const { t, locale } = useMemo(() => offlineManifestTranslator(), []);
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
  /**
   * Unsynced roll call this device threw away at the retention ceiling
   * (`OFFLINE_MANIFEST_PENDING_GRACE_MS`). Read from storage rather than
   * handed over by whatever triggered the delete: it usually happens where
   * there is no screen — the service worker's push refresh, the staff layout's
   * auto-save — so this surface is the first place a human can be told.
   */
  const [discarded, setDiscarded] = useState<DiscardedOfflineRecord[]>([]);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [noteByBooking, setNoteByBooking] = useState<Record<string, string>>({});
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
      const rejected = next.events.filter((event) => event.syncStatus === "rejected").length;
      const pending = next.events.filter((event) => event.syncStatus === "pending").length;
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
      const withPending = saved.filter((envelope) =>
        envelope.events.some((event) => event.syncStatus === "pending"),
      );
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
        (sum, envelope) =>
          sum + envelope.events.filter((event) => event.syncStatus === "rejected").length,
        0,
      );
      const pending = merged.reduce(
        (sum, envelope) =>
          sum + envelope.events.filter((event) => event.syncStatus === "pending").length,
        0,
      );
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
    const savedTrips = list ?? [];
    return (
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <OfflineShellVersionBanner copy={shellVersionCopy} />
        {discardNotice}
        <ShopPageHeader
          eyebrow={t("shared.offlineManifest.list.eyebrow")}
          title={
            savedTrips.length > 0
              ? t("shared.offlineManifest.list.headingWithTrips")
              : t("shared.offlineManifest.list.headingEmpty")
          }
          meta={
            <p className="text-muted" role="status" aria-live="polite">
              {message}
            </p>
          }
        />
        {savedTrips.length > 0 ? (
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-6 divide-y divide-border",
            })}
          >
            {savedTrips.map((saved) => {
              const tripManifest = saved.snapshot.manifests[0];
              if (!tripManifest) return null;
              const savedFreshness = offlineManifestFreshness(new Date(saved.snapshot.savedAt));
              // An expired-but-kept-alive record (see loadOfflineManifest) is
              // not a boarding source even though it's still readable — the
              // freshness pill alone would read identically to an ordinary
              // "Stale copy" that's still perfectly usable, so it needs its
              // own distinct label here (the per-trip view already says this
              // plainly once opened).
              const savedExpired = isOfflineManifestExpired(saved.snapshot);
              const dateTime = cachedFormatter("dt", Intl.DateTimeFormat, deviceLocale(), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: saved.snapshot.shop.timezone,
              });
              return (
                <li key={tripManifest.trip.id}>
                  <a
                    href={`/offline-manifest?trip=${tripManifest.trip.id}`}
                    className="flex min-h-14 flex-col gap-2 p-4 hover:bg-surface-sunken sm:flex-row sm:items-center sm:justify-between sm:p-5"
                  >
                    <div>
                      <p className="text-lg font-semibold">{tripManifest.trip.title}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {saved.snapshot.shop.name} ·{" "}
                        {dateTime.format(new Date(tripManifest.trip.startsAt))} ·{" "}
                        {t("shared.offlineManifest.list.diverCount", {
                          count: tripManifest.summary.totalDivers,
                        })}
                      </p>
                    </div>
                    {savedExpired ? (
                      <span className="inline-flex min-h-9 items-center self-start rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm font-bold text-danger">
                        {t("shared.offlineManifest.list.expiredViewOnly")}
                      </span>
                    ) : (
                      <OfflineFreshnessPill freshness={savedFreshness} className="self-start">
                        {t(`shared.offlineManifest.freshnessPill.${savedFreshness}`)}
                      </OfflineFreshnessPill>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-6 rounded-3xl border border-border bg-surface-sunken p-8 text-center sm:p-10">
            <div
              className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface text-2xl"
              aria-hidden="true"
            >
              📋
            </div>
            <p className="mx-auto mt-4 max-w-md text-muted">
              {t("shared.offlineManifest.list.emptyHint")}
            </p>
          </div>
        )}
      </main>
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
        <div className="mt-6 rounded-3xl border border-border bg-surface-sunken p-8 text-center sm:p-10">
          <div
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface text-2xl"
            aria-hidden="true"
          >
            ⛵
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

  const manifest =
    envelope.snapshot.manifests.find((entry) => entry.checkpoint === checkpoint) ??
    envelope.snapshot.manifests[0];
  if (!manifest) return null;
  // Readiness gates boarding at departure only. After a dive, roll call is a
  // head count — a diver aboard is recorded present whatever the saved paperwork
  // said. The server re-checks the same way, so an offline board still syncs.
  const isDeparture = checkpoint === "departure";
  // Kept readable past its retention window only so an unsynced event isn't
  // silently lost (see loadOfflineManifest) — the H-05 stop rule still treats
  // it as not a boarding source, so no new roll call can be recorded here.
  const expired = isOfflineManifestExpired(envelope.snapshot);
  const freshness = offlineManifestFreshness(new Date(envelope.snapshot.savedAt));
  const pending = envelope.events.filter((event) => event.syncStatus === "pending").length;
  const rejected = envelope.events.filter((event) => event.syncStatus === "rejected").length;
  const localStates = manifest.divers.map((diver) =>
    latestOfflineRollCall(envelope.snapshot, envelope.events, diver.bookingId, checkpoint),
  );
  const boarded = localStates.filter((state) => state?.state === "boarded").length;
  const awaiting = localStates.filter((state) => !state).length;
  // The dock copy splits `not_boarded` exactly the way the live manifest does
  // (`isNotBackAboard`, src/lib/manifests.ts): at departure it means the diver
  // never left, after a dive it means they have not come back. Offline and
  // online disagreeing about whether everyone is out of the water is worse than
  // either being wrong on its own, so both read the same predicate (DOM-H3).
  const notBackAboard = localStates.filter((state) => isNotBackAboard(checkpoint, state)).length;
  // Both halves now come from this device's own events, read through the two
  // sibling functions in `offline-manifests.ts`: a crew member's result is
  // local-first with the snapshot's saved result behind it, exactly as a
  // diver's is. Before H-46 the crew half could only ever be the save-time
  // answer, because there was no id on this copy to write an event against —
  // which is still the case for a copy saved before that change, and is why
  // this falls back to `member.rollCall` rather than assuming an id.
  //
  // Absence is "nobody has said", never "accounted for", on both routes. A
  // checkpoint with every diver counted and a crew member uncalled reads *open*
  // here exactly as it does online; never "complete" offline and "not complete"
  // online, which is the one direction that matters — a head count that looks
  // finished while somebody is still in the water.
  const crewAssigned = manifest.crew.length;
  const crewWithState = manifest.crew.map((member) => {
    const saved = member.rollCall;
    const state = member.id
      ? latestOfflineCrewRollCall(envelope.snapshot, envelope.events, member.id, checkpoint)
      : saved
        ? {
            state: saved.state,
            occurredAt: saved.occurredAt,
            pending: false,
            implied: saved.implied ?? false,
            // Straight off the snapshot — nobody recorded this here, so there
            // is nothing on this copy to retract (see `OfflineRollCallResult.local`).
            // A crew member with no id has no subject to write an event
            // against anyway, which is why this branch exists at all.
            local: false,
          }
        : undefined;
    return { ...member, state };
  });
  const completeness = rollCallCompleteness({
    checkpoint,
    totalDivers: manifest.summary.totalDivers,
    awaiting,
    notBackAboard,
    crew: crewWithState.map((member) => ({ rollCall: member.state })),
  });
  const crewCounts = completeness.crewCounts;
  // `id` is the list key now that the dock copy carries one (H-46) — the same
  // stable identity the live manifest uses, and what keeps two crew who share
  // a name *and* a role apart (review 20260803, D6). A copy saved before that
  // change has no ids, so the old namesake-disambiguating key stays behind it:
  // those rows still have to render.
  const crewSeen = new Map<string, number>();
  const crewWithKeys = crewWithState.map((member) => {
    const base = `${member.fullName}\u0000${member.roles.join(",")}`;
    const nth = crewSeen.get(base) ?? 0;
    crewSeen.set(base, nth + 1);
    return { ...member, key: member.id ?? `${base}\u0000${nth}` };
  });
  // Two different facts, and a crew reading warning-yellow on every single dive
  // stops reading it at all (review 20260803, D6):
  //
  // - somebody **is unaccounted for**: a named crew member was recorded not back
  //   aboard. That is an emergency and reads as danger, wherever the divers are.
  // - part of the crew half **cannot be recorded on this copy**: a snapshot
  //   saved before crew ids rode along (H-46) carries crew with no subject to
  //   write an event against, so those people stay uncountable until this
  //   device sees a newer copy. It is fail-closed — the checkpoint does *not*
  //   read complete — and it is stated as a limitation of this saved copy, not
  //   as an alarm. On a current copy it is not stated at all, because there is
  //   no longer anything to apologise for.
  const crewMissing = completeness.crewReason === "crew_not_back_aboard";
  const crewWithoutId = crewWithKeys.filter((member) => !member.id).length;
  const rollCallComplete = completeness.complete;
  // The actual roster rendered on this device, not the (possibly stale,
  // save-time) `manifest.summary.totalDivers`. Feeds MilestoneHaptics and the
  // roll-call-complete celebration below.
  const totalDivers = manifest.divers.length;
  // Dive-domain-expert review (task 72, invariant 4): "not boarded" carries
  // forward at later checkpoints and never resets to awaiting, so
  // `rollCallComplete` (awaiting === 0) goes true for a checkpoint with
  // carried-forward not-boarded divers on it — that's correct for the
  // heading text above ("Roll call complete" is accurate either way), but an
  // "everyone's aboard" celebration must not fire on that basis. Gate it on
  // the true boarded count instead.
  const allBoarded = totalDivers > 0 && boarded === totalDivers;
  const missingDivers = manifest.divers.filter((_diver, index) => !localStates[index]);
  // Whether anyone on this saved copy carries a team — gates the one line that
  // says the split-team read belongs to the live roll call. Crew count too:
  // a boat where only the divemaster's groups were recorded still needs the
  // limitation stated.
  const anyBuddies =
    manifest.divers.some((diver) => (diver.buddyTeamNames ?? []).length > 0) ||
    manifest.crew.some((member) => (member.buddyTeamNames ?? []).length > 0);

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
    note = "",
  ) {
    // Whatever this tap turns out to be, no confirmation is left armed behind
    // it — including the refusals below, which end the act just as finally as a
    // write does.
    setConfirmAboardFor(null);
    if (expired) {
      setMessage(t("shared.offlineManifest.single.record.expiredCannotRecord"));
      return;
    }
    const bookingId = "bookingId" in subject ? subject.bookingId : undefined;
    setBusyBooking("bookingId" in subject ? subject.bookingId : subject.crewPersonId);
    try {
      const next = await appendOfflineRollCall(tripId, {
        ...subject,
        ...statement,
        checkpoint,
        note: note.trim() || null,
      });
      dispatchSaved({ type: "loaded", envelope: next });
      setMessage(t("shared.offlineManifest.single.record.saved"));
      // Task 73: a typed note must not silently ride along on the next tap
      // for this diver (e.g. tapping "Not boarded" again later re-sends a
      // stale note nobody re-typed). Crew rows carry no note field, here or on
      // the live manifest, so there is nothing to clear for them.
      if (bookingId !== undefined) {
        setNoteByBooking((current) => {
          if (!(bookingId in current)) return current;
          const next = { ...current };
          delete next[bookingId];
          return next;
        });
      }
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

  const dateTime = cachedFormatter("dt", Intl.DateTimeFormat, deviceLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: envelope.snapshot.shop.timezone,
  });

  return (
    <main className="boat-mode mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <AmbientGlareDetector />
      <OfflineShellVersionBanner copy={shellVersionCopy} />
      {discardNotice}
      <SkipLink href="#offline-roll-call" label={t("shared.offlineManifest.single.skipLink")} />
      <div className="border-b border-border pb-6">
        <ShopPageHeader
          align="start"
          eyebrow={t("shared.offlineManifest.single.eyebrow")}
          title={manifest.trip.title}
          description={t("shared.offlineManifest.single.savedAt", {
            when: dateTime.format(new Date(envelope.snapshot.savedAt)),
          })}
          actions={
            <>
              <div className="print:hidden">
                <AmbientContrastControl
                  copy={{
                    modeLabel: t("shared.boatMode.modeLabel"),
                    labelAuto: t("shared.boatMode.labelAuto"),
                    labelLand: t("shared.boatMode.labelLand"),
                    labelBoat: t("shared.boatMode.labelBoat"),
                  }}
                />
              </div>
              <ConnectivityStatus
                offlineLabel={t("shared.connectivity.offlineWithCopy")}
                copy={{
                  online: t("shared.connectivity.online"),
                  onlineTitle: t("shared.connectivity.onlineTitle"),
                  offlineTitle: t("shared.connectivity.offlineTitle"),
                }}
              />
              <OfflineFreshnessPill freshness={freshness}>
                {t(`shared.offlineManifest.freshnessPill.${freshness}`)}
              </OfflineFreshnessPill>
            </>
          }
        />
        {expired ? (
          <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-base leading-6 font-semibold text-danger">
            {t("shared.offlineManifest.single.expiredBanner")}
          </p>
        ) : (
          <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-base leading-6">
            {t("shared.offlineManifest.single.freshnessBanner", {
              freshnessNote: t(`shared.offlineManifest.freshnessCopy.${freshness}`),
            })}
          </p>
        )}
        <p className="mt-3 text-sm font-medium" role="status" aria-live="polite">
          {message}
        </p>
        <p className="mt-1 text-sm text-muted">
          {t("shared.offlineManifest.single.pendingRejectedCounts", { pending, rejected })}
        </p>
      </div>

      <nav
        className="mt-6 flex flex-wrap items-center gap-2 overflow-x-auto pb-2"
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
        <WaterLockerToggle
          copy={{ disableToggleLabel: t("shared.waterLocker.disableToggleLabel") }}
        />
      </nav>

      <section
        className={
          rollCallComplete
            ? "rise-in mt-4 grid grid-cols-3 gap-3 rounded-2xl border border-accent/50 bg-accent/10 p-3"
            : "mt-4 grid grid-cols-3 gap-3"
        }
      >
        {[
          [t("shared.offlineManifest.single.statsDivers"), manifest.summary.totalDivers],
          [t("shared.offlineManifest.single.statsBoarded"), boarded],
          [t("shared.offlineManifest.single.statsAwaiting"), awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs font-semibold text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          {rollCallComplete
            ? t("shared.offlineManifest.single.rollCallCompleteHeading")
            : t("shared.offlineManifest.single.checkpointRollCallHeading", {
                checkpoint: rollCallCheckpointText(t, checkpoint),
              })}
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
        <div
          className={
            crewMissing
              ? "mt-3 rounded-xl border border-danger bg-danger/10 p-3 ring-1 ring-inset ring-danger/40"
              : completeness.crewAccountedFor
                ? "mt-3 rounded-xl border border-success/40 bg-success/10 p-3"
                : "mt-3 rounded-xl border border-border-strong bg-surface-sunken p-3"
          }
        >
          <p className={`text-sm font-bold${crewMissing ? " text-danger" : ""}`}>
            {t("shared.offlineManifest.single.crewHeading")}
          </p>
          <p className="mt-1 text-sm">
            {crewMissing
              ? t("shared.offlineManifest.single.crewNotBackAboard", {
                  count: crewCounts.crewNotBackAboard,
                })
              : completeness.crewReason === "crew_awaiting"
                ? t("shared.offlineManifest.single.crewAwaiting", {
                    count: crewCounts.crewAwaiting,
                  })
                : completeness.crewReason === "crew_none_assigned"
                  ? t("shared.offlineManifest.single.crewNoneAssigned")
                  : completeness.crewReason === "crew_none_aboard"
                    ? t("shared.offlineManifest.single.crewNoneAboard")
                    : t("shared.offlineManifest.single.crewAllAccountedFor", {
                        assigned: crewAssigned,
                      })}
          </p>
          {/* The one remaining limitation, and it belongs to the *copy*, not
              to the feature: a snapshot older than H-46 has crew with no id,
              so there is nobody for a tap to be about. Named with a count, so
              a captain can tell whether it is the whole crew or one late
              addition, and pointed at the two things that fix it. Absent
              entirely on a current copy. */}
          {crewWithoutId > 0 ? (
            <p className="mt-1 text-sm font-semibold text-muted">
              {t("shared.offlineManifest.single.crewOlderCopy", { count: crewWithoutId })}
            </p>
          ) : null}
          {/* Who, not just how many — and now with the controls to answer for
              each one, the same two the diver rows carry. Crew take no note
              field, here or on the live manifest. */}
          {crewAssigned > 0 ? (
            // Ided like the diver list below it, and for the same reason: both
            // are now lists of rows with roll-call controls on them, so
            // anything reaching for "the first Mark aboard button" has to be
            // able to say which list it means.
            <ul id="offline-crew-roll-call" className="mt-2 space-y-2">
              {crewWithKeys.map((member) => {
                // Hoisted so the guard below narrows it for both handlers: a
                // crew member with no id has no subject to record against.
                const crewPersonId = member.id;
                const crewRowState = rollCallRowState(checkpoint, member.state);
                const missingCrew = crewRowState.notBackAboard;
                const crewRecordedNotBoarded = crewRowState.recordedNotBoarded;
                const crewTone = rollCallRecordedTone(crewRowState);
                return (
                  <li
                    key={member.key}
                    // One colour vocabulary with the live manifest's rows,
                    // now by import rather than by copy — see
                    // `OFFLINE_CREW_ROW_TONE` for why the shape differs and
                    // the hues do not.
                    className={`rounded-xl px-3 py-2 text-sm ${
                      crewTone ? OFFLINE_CREW_ROW_TONE[crewTone] : OFFLINE_CREW_ROW_TONE.awaiting
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p>
                        {member.fullName} ·{" "}
                        {rollCallLabelText(t, rollCallLabel(checkpoint, member.state))}
                        {member.state?.pending
                          ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                          : ""}
                        {/* The groups this crew member is on, saved as names.
                            Same display-only rule as a diver's — a divemaster
                            leading three groups needs the dock copy to say
                            which bodies they are responsible for. */}
                        {(member.buddyTeamNames ?? []).length > 0 ? (
                          <span className="ms-1 font-normal">
                            ·{" "}
                            {t("shared.buddyTeam.with", {
                              names: cachedListFormat(locale, { type: "conjunction" }).format(
                                member.buddyTeamNames ?? [],
                              ),
                            })}
                          </span>
                        ) : null}
                      </p>
                      {/* No controls on an expired copy (the H-05 stop rule,
                          stated once in the banner above and enforced in
                          `record`), and none for a crew member this copy has
                          no id for. Otherwise both, always: crew carry no
                          readiness, so unlike a diver at the dock there is
                          nothing that can withhold the aboard control. */}
                      {expired || !crewPersonId ? null : (
                        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                          <button
                            type="button"
                            disabled={busyBooking === crewPersonId}
                            onClick={() => {
                              // Same two-tap gate the diver rows carry, with
                              // the confirmation below rather than under the
                              // thumb — and it applies to a divemaster for the
                              // stronger reason: crew are the people most
                              // reliably in the water.
                              if (missingCrew && confirmAboardFor !== crewPersonId) {
                                setConfirmAboardFor(crewPersonId);
                                return;
                              }
                              if (missingCrew) {
                                setConfirmAboardFor(null);
                                return;
                              }
                              void record(
                                { crewPersonId },
                                reTap(member.state, member.state?.state === "boarded", "boarded"),
                              );
                            }}
                            aria-busy={busyBooking === crewPersonId}
                            className={`${OFFLINE_BOAT_TARGET_CLASS} ${
                              missingCrew && confirmAboardFor === crewPersonId
                                ? "border border-border-strong bg-surface-sunken"
                                : member.state?.state === "boarded"
                                  ? "border border-success bg-success/15 text-success"
                                  : "bg-primary text-primary-foreground"
                            }`}
                          >
                            {busyBooking === crewPersonId
                              ? t("shared.offlineManifest.single.saving")
                              : missingCrew && confirmAboardFor === crewPersonId
                                ? t("shared.offlineManifest.single.confirmAboardCancel")
                                : member.state?.state === "boarded"
                                  ? t("manifest.crewAboardCheck")
                                  : t("manifest.crewMarkAboard")}
                          </button>
                          {/* The exception control, at the live page's weights
                              and by the live page's rules — and never a
                              done-check after a dive, because "Not aboard ☑️"
                              beside a divemaster still in the water is the
                              string every one of these rules exists to
                              delete (DOM-H3).
                              Re-tapping it once it carries the recorded state
                              queues the **retraction** (`cleared`), the same
                              undo the live control has always emitted — not a
                              second copy of the mark, and never a trip through
                              "Mark aboard", which would put a sighting nobody
                              made into the departure log. */}
                          <button
                            type="button"
                            disabled={busyBooking === crewPersonId}
                            onClick={() =>
                              record(
                                { crewPersonId },
                                // This device's own statement only, and named —
                                // see the diver control below for why a
                                // retraction is never aimed at a snapshot
                                // result and never leaves its target unsaid.
                                reTap(member.state, crewRecordedNotBoarded, "not_boarded"),
                              )
                            }
                            aria-busy={busyBooking === crewPersonId}
                            className={
                              missingCrew
                                ? `${OFFLINE_BOAT_TARGET_CLASS} border border-danger bg-danger/15 text-danger`
                                : crewRecordedNotBoarded
                                  ? `${OFFLINE_BOAT_TARGET_CLASS} border border-border-strong bg-surface-sunken`
                                  : isDeparture
                                    ? `${OFFLINE_BOAT_TARGET_CLASS} hover:bg-surface-sunken`
                                    : `${OFFLINE_BOAT_TARGET_CLASS} text-danger hover:bg-danger/10`
                            }
                          >
                            {busyBooking === crewPersonId
                              ? t("shared.offlineManifest.single.saving")
                              : crewRecordedNotBoarded
                                ? isDeparture
                                  ? t("manifest.crewNotAboardCheck")
                                  : t("manifest.crewNotBackAboardActive")
                                : isDeparture
                                  ? t("manifest.crewMarkNotAboard")
                                  : t("manifest.crewMarkNotBackAboard")}
                          </button>
                        </div>
                      )}
                    </div>
                    {/* One line under a not-back-aboard row, and only there:
                        the mark that is loudest is also the one a crew member
                        must be certain they can take straight back off, or
                        they stop raising it (design/principles.md §7, and the
                        live manifest's own `tapToUndoNotBackAboard`). While a
                        confirmation is armed it says what the next tap will
                        claim, and offers the way out. */}
                    {crewRowState.recordedHere && missingCrew && !expired && crewPersonId ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <p className="text-sm text-muted">
                          {confirmAboardFor === crewPersonId
                            ? t("shared.offlineManifest.single.confirmAboardHint", {
                                name: member.fullName,
                              })
                            : member.state?.local
                              ? t("manifest.tapToUndoNotBackAboard")
                              : t("shared.offlineManifest.single.markedElsewhere")}
                        </p>
                        {confirmAboardFor === crewPersonId ? (
                          <button
                            type="button"
                            disabled={busyBooking === crewPersonId}
                            onClick={() => record({ crewPersonId }, { status: "boarded" })}
                            aria-busy={busyBooking === crewPersonId}
                            className={`${OFFLINE_BOAT_TARGET_CLASS} border border-warning bg-warning/15 font-bold`}
                          >
                            {t("shared.offlineManifest.single.confirmAboard", {
                              name: member.fullName,
                            })}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        {/* Buddy teams are display-only on the dock copy, and the split-team
            read ("someone back, someone not") belongs to the live roll call
            alone — a snapshot cannot know who came back (ADR
            20260804-buddy-teams). Stated the same neutral way as the crew
            limitation above: a limitation of this copy, not an alarm. */}
        {anyBuddies ? (
          <p className="mt-3 text-sm font-semibold text-muted">
            {t("shared.offlineManifest.single.buddyReadOnlyHere")}
          </p>
        ) : null}
        <ul
          id="offline-roll-call"
          tabIndex={-1}
          className={sectionCardClass({
            padding: "none",
            className: "mt-4 divide-y divide-border outline-none",
          })}
        >
          {manifest.divers.map((diver, index) => {
            const state = latestOfflineRollCall(
              envelope.snapshot,
              envelope.events,
              diver.bookingId,
              checkpoint,
            );
            const ready = diver.readiness.status === "ready";
            // The live manifest's own derivation, not a second copy of it
            // (`src/lib/manifests.ts`). The copy this replaces got two things
            // wrong that only showed on the water: it keyed the *boarded* fill
            // off "any result exists", so a diver recorded **not boarded** at
            // the dock rendered in the aboard colour, and it painted a diver
            // nobody had called yet amber with a ring — the two marks reserved
            // for "left ashore" and "did not come back".
            const rowState = rollCallRowState(checkpoint, state);
            // Recorded here at this checkpoint, either way round — a
            // carried-forward dock result is not undoable and gets the
            // "Mark…" wording, same as the live manifest.
            const recordedNotBoarded = rowState.recordedNotBoarded;
            const missing = rowState.notBackAboard;
            const recordedTone = rollCallRecordedTone(rowState);
            // Untouched: the same rule the live page uses — at the dock a
            // diver readiness has not cleared is blocked, and readiness is the
            // thing to fix before boarding; everywhere else nothing has been
            // said yet.
            const untouchedTone =
              ready || !isDeparture ? ROLL_CALL_ROW_TONE.awaiting : ROLL_CALL_ROW_TONE.blocked;
            // Same condition the live page passes as `showBoardControl`: divers
            // only board at departure once readiness clears them. Named, because
            // the exception control's weight now reads it too — it is what
            // decides whether that control is the row's *only* one.
            const showBoardControl = ready || !isDeparture;
            return (
              <li
                key={diver.bookingId}
                id={`offline-roll-call-${diver.bookingId}`}
                // Every row is a jump target — the missing-divers grid links
                // to any uncalled person — so every row carries the scroll
                // margin that keeps its name clear of the sticky panel, not
                // just the two states that used to.
                className={`scroll-mt-24 border-l-4 p-4 sm:p-5 ${
                  recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : untouchedTone
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm font-bold tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <h3 className="text-lg font-semibold">{diver.fullName}</h3>
                      {/* The shared pill, and the shared tone resolver. The
                          hand-rolled one this replaces paired `text-success`
                          with `bg-success/10`, the combination `Badge`
                          documents as measuring under AA at pill sizes — on
                          the surface read in direct sunlight. The words stay
                          the offline ones ("Ready when saved"), because that
                          distinction is real: this is a snapshot, not live. */}
                      <Badge tone={readinessStatusTone(ready ? "ready" : "blocked")}>
                        {ready
                          ? t("shared.offlineManifest.single.readyBadge")
                          : t("shared.offlineManifest.single.blockedBadge")}
                      </Badge>
                      {/* Same resolver the live manifest renders (DOM-H3):
                          one word list, so a diver who has not come back from
                          dive one cannot read "Not boarded" here and "Not back
                          aboard" on the captain's screen. */}
                      <span
                        className={
                          missing
                            ? "rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger"
                            : "rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold"
                        }
                      >
                        {rollCallLabelText(t, rollCallLabel(checkpoint, state))}
                        {state?.pending
                          ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                          : ""}
                      </span>
                      {/* The saved team, always quiet here: this copy shows
                          who you are with and never judges whether the team is
                          split — that read is live-roll-call only (see the
                          note above the list). */}
                      <OfflineBuddyTeamChip t={t} locale={locale} names={diver.buddyTeamNames} />
                    </div>
                    {/* The live manifest's "Contact & gear" disclosure, in the
                        same clothes and under the same words — this copy and
                        that one are read minutes apart by the same captain, and
                        reference facts standing open on every row here while
                        they fold there is the divergence this closes.

                        `manifest.diverFactsSummary`, not an offline key
                        of its own: one word list is the whole point, exactly as
                        `rollCallLabelText` is shared for the state pills above.

                        No medical line to disclose here — the dock payload
                        deliberately never carries one (see the allow-list in
                        offline-manifests.ts) — so this is always the plain
                        two-fact summary, never the "& medical" variant. */}
                    <details className="group/offlinefacts mt-2 max-w-xl">
                      <summary className="group/summary flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-base font-medium text-muted select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                        <DisclosureCaret className="group-open/offlinefacts:rotate-90" />
                        <span className="group-hover/summary:underline">
                          {t("manifest.diverFactsSummary")}
                        </span>
                      </summary>
                      <div className="mb-1 grid gap-2 rounded-xl border border-border/70 bg-surface-sunken/50 p-3 text-base">
                        <p>
                          <span className="font-bold">
                            {t("shared.offlineManifest.single.emergencyContact")}
                          </span>
                          <span className="mt-0.5 block text-muted">
                            {diver.emergencyContactName && diver.emergencyContactPhone
                              ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                              : t("shared.offlineManifest.single.notOnFile")}
                          </span>
                        </p>
                        <p>
                          <span className="font-bold">
                            {t("shared.offlineManifest.single.rentalFit")}
                          </span>
                          <span className="mt-0.5 block text-muted">
                            {rentalFitLineText(t, locale, diver.rentalFit)}
                            {diver.nitroxRequested
                              ? ` ${t("shared.offlineManifest.single.nitroxRequestedSuffix")}`
                              : ""}
                          </span>
                        </p>
                      </div>
                    </details>
                    {!ready ? (
                      <ul className="mt-2 text-sm text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.code}>• {blocker.text}</li>
                        ))}
                      </ul>
                    ) : null}
                    {/* The same disclosure the live manifest's rows carry, in
                        the same clothes — the boat reads the two copies minutes
                        apart, so a note behind a permanently-boxed blue link
                        here and a quiet caret line there is one control wearing
                        two faces. The box belongs to the open panel: shut on
                        every diver it was a bordered card reading as an empty
                        input the length of the roster. */}
                    <details className="group/offlinenote mt-2 max-w-xl">
                      <summary className="group/summary flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-base font-medium text-muted select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                        <DisclosureCaret className="group-open/offlinenote:rotate-90" />
                        <span className="group-hover/summary:underline">
                          {t("shared.offlineManifest.single.addNoteSummary")}
                        </span>
                      </summary>
                      <div className="mb-1 rounded-xl border border-border/70 bg-surface-sunken/50 p-3">
                        {/* Named for the screen reader only: the summary one
                            line above already says "Add a note". */}
                        <label
                          htmlFor={`offline-roll-call-note-${diver.bookingId}`}
                          className="sr-only"
                        >
                          {t("shared.offlineManifest.single.optionalNote")}
                        </label>
                        <input
                          id={`offline-roll-call-note-${diver.bookingId}`}
                          maxLength={300}
                          value={noteByBooking[diver.bookingId] ?? ""}
                          onChange={(event) =>
                            setNoteByBooking((current) => ({
                              ...current,
                              [diver.bookingId]: event.target.value,
                            }))
                          }
                          placeholder={t("shared.offlineManifest.single.notePlaceholder")}
                          className={controlClass}
                        />
                        <p className="mt-1.5 text-xs text-muted">
                          {t("shared.offlineManifest.single.noteHint")}
                        </p>
                      </div>
                    </details>
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                    {expired ? (
                      <p className="text-sm font-semibold text-danger">
                        {t("shared.offlineManifest.single.record.expiredRecordOnLive")}
                      </p>
                    ) : (
                      <>
                        {showBoardControl ? (
                          <button
                            type="button"
                            disabled={busyBooking === diver.bookingId}
                            onClick={() => {
                              // **The one act on this surface that takes two
                              // taps, and the second one is somewhere else.**
                              // Over a stated "not back aboard", "Mark aboard"
                              // is a positive sighting — "I have eyes on her,
                              // she's aboard" — and it turns the loudest row
                              // the product has green from a full-width button
                              // directly beneath the one that raised it. So the
                              // first tap arms, and this control becomes the
                              // *safe* choice while the confirmation waits
                              // below, at different coordinates: a double-tap
                              // or a bounce on a wet screen — the exact failure
                              // this exists for — then lands on "keep the
                              // mark", never on the claim (dive-domain review,
                              // 2026-08-15).
                              if (missing && confirmAboardFor !== diver.bookingId) {
                                setConfirmAboardFor(diver.bookingId);
                                return;
                              }
                              if (missing) {
                                setConfirmAboardFor(null);
                                return;
                              }
                              void record(
                                { bookingId: diver.bookingId },
                                // Re-tapping a settled "Boarded ☑️" retracts
                                // it, exactly as the live control does: a
                                // sighting recorded against the wrong row is
                                // taken back as a retraction, not restated as
                                // its opposite. Only ever **this device's own**
                                // statement — see `OfflineRollCallResult.local`.
                                reTap(state, state?.state === "boarded", "boarded"),
                                noteByBooking[diver.bookingId],
                              );
                            }}
                            aria-busy={busyBooking === diver.bookingId}
                            // Settles into the live page's success outline once
                            // recorded, rather than staying a solid primary fill
                            // that reads as "still to do" beside a label saying
                            // it is done (RollCallControls, same two states).
                            className={`${OFFLINE_BOAT_TARGET_CLASS} ${
                              missing && confirmAboardFor === diver.bookingId
                                ? "border border-border-strong bg-surface-sunken"
                                : state?.state === "boarded"
                                  ? "border border-success bg-success/15 text-success"
                                  : "bg-primary text-primary-foreground"
                            }`}
                          >
                            {busyBooking === diver.bookingId
                              ? t("shared.offlineManifest.single.saving")
                              : missing && confirmAboardFor === diver.bookingId
                                ? t("shared.offlineManifest.single.confirmAboardCancel")
                                : state?.state === "boarded"
                                  ? t("shared.offlineManifest.single.boardedDone")
                                  : t("shared.offlineManifest.single.markBoarded")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busyBooking === diver.bookingId}
                          onClick={() =>
                            record(
                              { bookingId: diver.bookingId },
                              // Re-tap is the undo, the same as on the live
                              // manifest: it queues a **retraction**, so a
                              // mis-tapped "not back aboard" comes off as one
                              // rather than through "Mark aboard", which would
                              // write a sighting nobody made into a record an
                              // insurer may one day read.
                              //
                              // Only over a statement **this device queued**
                              // (`state.local`), and it says which one
                              // (`state.clientEventId`). Aiming a retraction at
                              // a snapshot result could take another crew
                              // member's missing-diver mark off the boat on the
                              // strength of a copy up to a fortnight old
                              // (security review, 2026-08-15); naming the
                              // target is what stops the same thing happening to
                              // a statement of this device's own that a second
                              // device has superseded since it synced (ADR
                              // 20260815-an-offline-retraction-names-its-target).
                              reTap(state, recordedNotBoarded, "not_boarded"),
                              noteByBooking[diver.bookingId],
                            )
                          }
                          aria-busy={busyBooking === diver.bookingId}
                          // The exception control, at the live page's weights
                          // and by the live page's rules (RollCallControls):
                          // most people board, so while nothing is recorded and
                          // the board button is on offer this drops its border
                          // and fill — the exception at less than equal weight
                          // (principle 8), still a full dock-sized target, and
                          // still foreground ink, because marking a no-show is
                          // routine on the surface with the harshest viewing
                          // conditions. It takes the box back the moment it
                          // matters: when it is the row's only control (a
                          // blocked diver at the dock), or when it carries the
                          // recorded state. After a dive the unrecorded label
                          // keeps danger ink — it is the control that reports a
                          // person missing, and it must be findable at the rail
                          // without reading every word.
                          className={
                            missing
                              ? `${OFFLINE_BOAT_TARGET_CLASS} border border-danger bg-danger/15 text-danger`
                              : recordedNotBoarded
                                ? `${OFFLINE_BOAT_TARGET_CLASS} border border-border-strong bg-surface-sunken`
                                : showBoardControl
                                  ? isDeparture
                                    ? `${OFFLINE_BOAT_TARGET_CLASS} hover:bg-surface-sunken`
                                    : `${OFFLINE_BOAT_TARGET_CLASS} text-danger hover:bg-danger/10`
                                  : `${OFFLINE_BOAT_TARGET_CLASS} border border-border hover:bg-surface-sunken`
                          }
                        >
                          {/* No done-check after a dive: "Not boarded ✓" beside a
                              diver still in the water is the string this whole
                              change exists to delete (DOM-H3). */}
                          {busyBooking === diver.bookingId
                            ? t("shared.offlineManifest.single.saving")
                            : recordedNotBoarded
                              ? isDeparture
                                ? t("shared.offlineManifest.single.notBoardedDone")
                                : t("shared.offlineManifest.single.notBackAboardActive")
                              : isDeparture
                                ? t("shared.offlineManifest.single.markNotBoarded")
                                : t("shared.offlineManifest.single.markNotBackAboard")}
                        </button>
                        {/* Same one line the crew rows carry, on the same
                            terms: the loudest mark on the page states how it
                            comes back off, and while a confirmation is armed
                            it states what the next tap would claim instead. */}
                        {rowState.recordedHere && missing ? (
                          <div className="flex w-full flex-col gap-2">
                            <p className="text-sm text-muted">
                              {confirmAboardFor === diver.bookingId
                                ? t("shared.offlineManifest.single.confirmAboardHint", {
                                    name: diver.fullName,
                                  })
                                : state?.local
                                  ? t("manifest.tapToUndoNotBackAboard")
                                  : t("shared.offlineManifest.single.markedElsewhere")}
                            </p>
                            {confirmAboardFor === diver.bookingId ? (
                              <button
                                type="button"
                                disabled={busyBooking === diver.bookingId}
                                onClick={() =>
                                  record(
                                    { bookingId: diver.bookingId },
                                    // A positive sighting, never a retraction:
                                    // this control asserts the diver is aboard
                                    // over a stated "not back aboard".
                                    { status: "boarded" },
                                    noteByBooking[diver.bookingId],
                                  )
                                }
                                aria-busy={busyBooking === diver.bookingId}
                                className={`${OFFLINE_BOAT_TARGET_CLASS} border border-warning bg-warning/15 font-bold`}
                              >
                                {t("shared.offlineManifest.single.confirmAboard", {
                                  name: diver.fullName,
                                })}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Same words as the live page, chosen by the same checkpoint rule: at
          the dock these are people still to board, after a dive they are
          people nobody has counted back aboard yet. The dock copy must never
          be louder than the live manifest about a benign state.

          **The grid stays here, and only here** (decision 20260812, closing
          FU-20260810-offline-manifest-checklist-grammar). The live manifest
          replaced its face grid with name chips because those chips live under
          a *sticky* checkpoint panel: they follow the reader down a
          nine-diver roster, so a jump target is always one thumb away. This
          page has no sticky panel — its stats row scrolls away with everything
          else — so the same chips would be in view exactly when nobody needs
          them and gone by the time they do.

          The grid is also a scanning surface rather than a jump list, and this
          is the copy read underway, at the rail, looking up from the water for
          a face rather than down at a name. Its rents-kit and blocked accents
          carry information no chip does. Keeping it is a considered divergence
          from the live page, not a leftover: the *rows* above now read
          identically on both surfaces, which is what a captain working the two
          minutes apart actually needs. */}
      <MissingDiversGrid
        divers={missingDivers.map((diver) => ({
          bookingId: diver.bookingId,
          fullName: diver.fullName,
          rentsKit: diver.rentalFit.state === "rents",
          blocked: diver.readiness.status === "blocked",
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
          blockedLabel: readinessStatusText(t, "blocked"),
        }}
      />

      <footer className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <a
          href={`/shop/${envelope.snapshot.shop.slug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
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
      <WaterLocker
        copy={{
          rainAlt: t("shared.waterLocker.rainAlt"),
          heading: t("shared.waterLocker.heading"),
          body: t("shared.waterLocker.body"),
          holdLine1: t("shared.waterLocker.holdLine1"),
          holdLine2: t("shared.waterLocker.holdLine2"),
          unlockingProgress: t.raw("shared.waterLocker.unlockingProgress"),
          holdToUnlock: t("shared.waterLocker.holdToUnlock"),
        }}
      />
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
    </main>
  );
}

/**
 * What this device threw away at the retention ceiling
 * (`OFFLINE_MANIFEST_PENDING_GRACE_MS`, security review 2026-08-06 F3): roll
 * call a crew member recorded offline that never reached DiveDay, on a saved
 * copy too old to keep. Deleting that silently would be its own harm — it is
 * unsynced evidence of who came back from a dive — so the store writes the loss
 * down and this says it out loud.
 *
 * Rendered on every branch of the shell, not only the one that happened to
 * trigger the delete: the delete usually happens with no page open at all (the
 * service worker's push refresh, the staff layout's auto-save), so "wherever a
 * human next looks" is the only delivery that works. It carries the shop and
 * trip so the loss is actionable, and no diver, contact or booking id — the
 * notice must not re-retain the roster the discard removed.
 *
 * Danger-toned and dismissed by hand rather than on display: this is the one
 * thing on this surface that cannot be recovered by reconnecting, and a captain
 * who was ashore that day should still find it waiting.
 */
function DiscardedRecordsNotice({
  t,
  records,
  onAcknowledge,
}: {
  t: StaffTranslator;
  records: DiscardedOfflineRecord[];
  onAcknowledge: () => void;
}) {
  if (records.length === 0) return null;
  const lostEvents = records.reduce((sum, record) => sum + record.pendingEvents, 0);
  return (
    <section
      role="alert"
      className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-base leading-6"
    >
      <p className="font-bold text-danger">{t("shared.offlineManifest.discarded.heading")}</p>
      <p className="mt-1">{t("shared.offlineManifest.discarded.body", { count: lostEvents })}</p>
      <ul className="mt-2 space-y-1 text-sm font-semibold">
        {records.map((record) => (
          <li key={`${record.tripId}:${record.discardedAt}`}>
            {t("shared.offlineManifest.discarded.item", {
              shop: record.shopName,
              trip: record.tripTitle,
              count: record.pendingEvents,
            })}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAcknowledge}
        className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
      >
        {t("shared.offlineManifest.discarded.acknowledge")}
      </button>
    </section>
  );
}

/**
 * The saved team a dock-copy row wears — names only, never a verdict. There is
 * deliberately no tone variant: this copy cannot know who came back, so it must
 * never look like it is telling you (ADR 20260804-buddy-teams).
 */
function OfflineBuddyTeamChip({
  t,
  locale,
  names,
}: {
  t: StaffTranslator;
  locale: string;
  names?: string[];
}) {
  if (!names || names.length === 0) return null;
  return (
    <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-muted">
      {t("shared.buddyTeam.with", {
        names: cachedListFormat(locale, { type: "conjunction" }).format(names),
      })}
    </span>
  );
}
