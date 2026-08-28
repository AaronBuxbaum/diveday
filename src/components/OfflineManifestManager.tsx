"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { OfflineFreshnessPill } from "@/components/OfflineFreshnessPill";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { GroupLabel } from "@/components/ui/ledger";
import { fill, pluralForm } from "@/i18n/fill";
import { requestBackgroundFlush } from "@/lib/background-flush";
import { formatDateTimeTz } from "@/lib/format";
import {
  loadOfflineManifest,
  primeOfflineManifestShell,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  type OfflineManifestEnvelope,
  type OfflineManifestPayload,
  offlineManifestFreshness,
} from "@/lib/offline-manifests";

// Fallback only — see ADR 20260726-manifest-push-refresh. The SSE
// subscription below is the primary trigger; this interval (plus
// reconnect/visibility triggers) is what still runs when SSE never connects
// or a boat's signal drops, which push alone can never cover.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

/** Every word `OfflineManifestManager` renders, resolved server-side. */
export interface OfflineManifestManagerCopy {
  checkingDevice: string;
  reconcileRejectedOne: string;
  /** `{count}` placeholder. */
  reconcileRejectedOther: string;
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
  heading: string;
  body: string;
  connectivityOfflineWithCopy: string;
  connectivityOffline: string;
  connectivityOnline: string;
  connectivityOnlineTitle: string;
  connectivityOfflineTitle: string;
  freshnessCurrent: string;
  freshnessAging: string;
  freshnessStale: string;
  /** `{date}`, `{pending}`, `{rejected}` placeholders. */
  savedSummary: string;
  refreshingLabel: string;
  refreshNowLabel: string;
  openOfflineRollCall: string;
  /**
   * The heading of the whole "On this phone" group this component now *is* —
   * the disclosure it renders holds every per-device concern, not only the
   * offline copy. See the render below.
   */
  groupHeading: string;
}

export function OfflineManifestManager({
  payload,
  locale,
  copy,
  children,
}: {
  payload: OfflineManifestPayload;
  /** Negotiated request locale (see requestLocale) — never hard-coded, per AGENTS.md. */
  locale: string;
  copy: OfflineManifestManagerCopy;
  /**
   * The rest of the "On this phone" group — the push opt-in and the device
   * toggles — rendered inside this component's disclosure.
   *
   * They are passed in rather than imported because they are per-*surface*
   * concerns this component has no business knowing about, while the
   * disclosure itself has to live here: the summary line carries the live
   * connectivity and freshness state, and that state has exactly one owner.
   * Handing the collapse to the page instead would mean a second reader of the
   * offline store, which is the drift that gave the offline view its own wrong
   * copy of the row tones once already.
   */
  children?: ReactNode;
}) {
  const router = useRouter();
  const tripId = payload.manifests[0]?.trip.id ?? "";
  const [saved, setSaved] = useState<OfflineManifestEnvelope | null>(null);
  const [message, setMessage] = useState(copy.checkingDevice);
  const [busy, setBusy] = useState(false);
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
  const lastPendingCount = useRef(0);
  const lastRejectedCount = useRef(0);
  // Set right before a manual "Refresh now" (or router.refresh() call below)
  // whose resulting save should show the loud confirmation instead of
  // passing silently, since the save itself only happens once the refreshed
  // payload actually lands as a prop (see the payload effect).
  const manualRefreshPending = useRef(false);

  const runReconcileOnce = useCallback(async () => {
    if (!tripId) return;
    // Offline, or a reconcile that could not reach the server: hand the flush
    // to Background Sync so it happens when signal returns *even if this page
    // is gone by then* (ADR 20260804-manifest-web-push). Without this, roll
    // call recorded at sea waits for somebody to reopen DiveDay — and those
    // events are the record of who came back aboard.
    if (!navigator.onLine) {
      await requestBackgroundFlush();
      return;
    }
    const pendingBefore = lastPendingCount.current;
    const rejectedBefore = lastRejectedCount.current;
    try {
      const envelope = await syncOfflineManifest(tripId);
      if (envelope) {
        setSaved(envelope);
        const rejected = envelope.events.filter((event) => event.syncStatus === "rejected").length;
        const pending = envelope.events.filter((event) => event.syncStatus === "pending").length;
        lastPendingCount.current = pending;
        lastRejectedCount.current = rejected;
        // Only narrate/refresh the live page on a genuine transition this
        // round (something was pending before, or a new rejection landed) —
        // a snapshot with only long-resolved events stays silent forever.
        if (pendingBefore > 0 || rejected > rejectedBefore) {
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
      // fallback string already says.
      setMessage(copy.reconcileErrorFallback);
      // Same reasoning as the offline branch above: a failed flush is exactly
      // what Background Sync is for, and this page may not be here to retry.
      await requestBackgroundFlush();
    }
  }, [router, tripId, copy]);

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
      if (!opts.silent) {
        setBusy(true);
        setMessage(copy.savingMessage);
      }
      try {
        await primeOfflineManifestShell();
        const envelope = await saveOfflineManifest(payloadRef.current);
        setSaved(envelope);
        lastPendingCount.current = envelope.events.filter(
          (event) => event.syncStatus === "pending",
        ).length;
        lastRejectedCount.current = envelope.events.filter(
          (event) => event.syncStatus === "rejected",
        ).length;
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
    [copy],
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
      const envelope = await loadOfflineManifest(tripId).catch(() => null);
      if (cancelled) return;
      setSaved(envelope);
      // The pills and the saved-summary line take over the moment there is an
      // envelope for them to describe — "Checking this device…" only stands in
      // for a card with nothing on it yet, and left up beside "Fresh copy ·
      // Saved 9:30 AM" it is a fourth voice saying the same thing. A failure
      // from the save below still lands in this same region.
      if (envelope) setMessage("");
      // Reflects reality even when the branch below can't run yet (e.g. this
      // mount happens while offline) — otherwise reconcile()'s "did anything
      // just resolve/newly reject" check compares against a stale 0 once
      // connectivity returns, on a device that already had events from before.
      lastPendingCount.current =
        envelope?.events.filter((event) => event.syncStatus === "pending").length ?? 0;
      lastRejectedCount.current =
        envelope?.events.filter((event) => event.syncStatus === "rejected").length ?? 0;
      if (navigator.onLine) {
        const manual = manualRefreshPending.current;
        manualRefreshPending.current = false;
        await save({ silent: !manual });
        if (cancelled) return;
        await reconcile();
      } else {
        setMessage(envelope ? copy.offlineWithSavedCopy : copy.offlineNoSavedCopy);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, payload, save, reconcile]);

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
      if (navigator.onLine) refresh({ manual: false });
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
  }, [tripId, refresh]);

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

  const pending = saved?.events.filter((event) => event.syncStatus === "pending").length ?? 0;
  const rejected = saved?.events.filter((event) => event.syncStatus === "rejected").length ?? 0;
  const freshness = saved ? offlineManifestFreshness(new Date(saved.snapshot.savedAt)) : null;
  const freshnessLabel =
    freshness === "current"
      ? copy.freshnessCurrent
      : freshness === "aging"
        ? copy.freshnessAging
        : copy.freshnessStale;

  // A rejected event is a tap a crew member made that **never entered the
  // safety trail** — somebody stood on a deck, said "aboard", saw it stick, and
  // the server refused it when signal came back. Left in this card at the foot
  // of the page it is a sentence nobody scrolls to, on the one page where an
  // unrecorded roll call is the whole failure mode. So it is lifted out of the
  // card and pinned over the page instead, in danger tone with an `alert` role,
  // while pending/caught-up/saving stay in the card below where they belong.
  const rejectedNotice =
    rejected > 0
      ? fill(
          pluralForm(rejected, {
            one: copy.reconcileRejectedOne,
            other: copy.reconcileRejectedOther,
          }),
          { count: rejected },
        )
      : null;

  return (
    <>
      {rejectedNotice ? (
        /* Pinned just under the chrome bar, whose height it reads rather than
           measures (`--chrome-h`, ADR 20260827-clearwater-surface-language,
           decision 10). This was `top-20`, a number taken off the old 69px
           staff bar; the breathing room that number smuggled in is `pt-3` now,
           where it is a spacing decision rather than a stale measurement. */
        <div className="pointer-events-none fixed inset-x-0 top-(--chrome-h) z-40 flex justify-center px-4 pt-3 print:hidden">
          <div
            role="alert"
            className="pointer-events-auto max-w-2xl rounded-xl border border-danger/30 bg-danger-tint px-4 py-3 text-base font-semibold text-danger shadow-lg backdrop-blur"
          >
            {rejectedNotice}
          </div>
        </div>
      ) : null}
      {/* **The whole "On this phone" group, as one line at rest** (ADR
          20260827-the-departure-is-two-working-surfaces, decision 2: device
          settings and offline detail are "ashore, not here"). Everything this
          *device* does — hold an offline copy, wake itself for a refresh,
          ignore spray on the glass, buzz — is one per-phone concern rather than
          anything about this departure, and at full height it spent the foot of
          every manifest on preferences nobody changes twice.

          **The state is not what collapses.** A stale copy that looks current
          is the failure mode this whole mechanism exists to prevent
          (docs/design/principles.md), so the connectivity chip and the
          freshness pill ride the *summary* — readable without a tap, exactly as
          before. What went behind the tap is the prose, the two buttons and the
          toggles. That is also why this component owns the disclosure rather
          than the page wrapping it in one: the line that must stay visible is
          computed here, and there is one reader of the store.

          Still a backstop rather than the way in: the shop-wide auto-prime
          already saves the near-term board on any /shop page visit (ADR
          20260726-shopwide-offline-manifest-priming), and once a boat is truly
          out of signal this live page does not load at all —
          /offline-manifest is what a captain opens. */}
      <section
        className={sectionCardClass({ padding: "none", className: "mt-8 print:hidden" })}
        aria-labelledby="offline-heading"
      >
        <details className="group/phone">
          <summary className="group/summary flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
            <DisclosureCaret className="group-open/phone:rotate-90" />
            {/* A deliberate eyebrow rather than a section heading, which is a
                scale `SectionCard`'s own `title` does not render. */}
            <GroupLabel as="h2" id="offline-heading" className="group-hover/summary:underline">
              {copy.groupHeading}
            </GroupLabel>
            <span className="flex flex-wrap items-center gap-2">
              <ConnectivityStatus
                offlineLabel={saved ? copy.connectivityOfflineWithCopy : copy.connectivityOffline}
                copy={{
                  online: copy.connectivityOnline,
                  onlineTitle: copy.connectivityOnlineTitle,
                  offlineTitle: copy.connectivityOfflineTitle,
                }}
              />
              {freshness ? (
                <OfflineFreshnessPill freshness={freshness}>{freshnessLabel}</OfflineFreshnessPill>
              ) : null}
            </span>
          </summary>
          <div className="px-4 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h3 className="font-semibold">{copy.heading}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{copy.body}</p>
                {/* The live region stays mounted whether or not it currently has
                    anything to say, so an announcement is heard when one
                    arrives. */}
                <p className={message ? "mt-2 text-sm font-medium" : ""} aria-live="polite">
                  {message}
                </p>
                {saved ? (
                  <p className="mt-1 text-xs text-muted">
                    {fill(copy.savedSummary, {
                      date: formatDateTimeTz(
                        new Date(saved.snapshot.savedAt),
                        locale,
                        payload.shop.timezone,
                      ),
                      pending: String(pending),
                      rejected: String(rejected),
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => refresh({ manual: true })}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {busy ? copy.refreshingLabel : copy.refreshNowLabel}
                </button>
                {saved ? (
                  // `secondary`, deliberately: this is the standby door to the
                  // fallback viewer, on a panel whose chips already say the copy
                  // maintains itself — as `primary` it was the strongest control
                  // on the whole manifest, outshouting the roll call above it
                  // (principle 8; design review 2026-08-21). Still boat-sized:
                  // the moment it is needed is the moment of wet hands.
                  <a
                    href={`/offline-manifest?trip=${tripId}`}
                    className={buttonClass({ variant: "secondary", size: "boat" })}
                  >
                    {copy.openOfflineRollCall}
                  </a>
                ) : null}
              </div>
            </div>
            {/* `empty:hidden` because the rows the surface passes in render
                *nothing* under ordinary conditions — the push opt-in while it is
                still checking the device and on any deployment with no VAPID
                keys, the spray-guard toggle until it has read this device's
                stored preference — and a separator above nothing is a rule
                across an empty band. */}
            <div className="mt-4 space-y-4 border-t border-border pt-4 empty:hidden">
              {children}
            </div>
          </div>
        </details>
      </section>
    </>
  );
}
