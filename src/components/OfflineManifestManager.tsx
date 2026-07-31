"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { buttonClass } from "@/components/ui/button";
import { fill, pluralForm } from "@/i18n/fill";
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
  saveSuccessMessage: string;
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
}

export function OfflineManifestManager({
  payload,
  locale,
  copy,
}: {
  payload: OfflineManifestPayload;
  /** Negotiated request locale (see requestLocale) — never hard-coded, per AGENTS.md. */
  locale: string;
  copy: OfflineManifestManagerCopy;
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
    if (!tripId || !navigator.onLine) return;
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
          setMessage(
            rejected > 0
              ? fill(
                  pluralForm(rejected, {
                    one: copy.reconcileRejectedOne,
                    other: copy.reconcileRejectedOther,
                  }),
                  { count: rejected },
                )
              : pending > 0
                ? fill(
                    pluralForm(pending, {
                      one: copy.reconcilePendingOne,
                      other: copy.reconcilePendingOther,
                    }),
                    { count: pending },
                  )
                : copy.reconcileCaughtUp,
          );
          router.refresh();
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : copy.reconcileErrorFallback);
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
        // Settled message either way — a silent background save still needs
        // to land on something other than the initial "Checking…" text.
        setMessage(copy.saveSuccessMessage);
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
  // reconnects on its own when the stream drops (a Vercel duration cutoff, a
  // network blip); this effect doesn't need its own retry logic. When the
  // stream never connects at all (e.g. blocked by a captive portal), the
  // interval/reconnect/visibility effect above is what still keeps this
  // device current.
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

  const pending = saved?.events.filter((event) => event.syncStatus === "pending").length ?? 0;
  const rejected = saved?.events.filter((event) => event.syncStatus === "rejected").length ?? 0;
  const freshness = saved ? offlineManifestFreshness(new Date(saved.snapshot.savedAt)) : null;
  const freshnessLabel =
    freshness === "current"
      ? copy.freshnessCurrent
      : freshness === "aging"
        ? copy.freshnessAging
        : copy.freshnessStale;

  return (
    <section
      className="mt-5 rounded-xl border border-border bg-surface p-4 print:hidden"
      aria-labelledby="offline-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="offline-heading" className="font-semibold">
            {copy.heading}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">{copy.body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ConnectivityStatus
              offlineLabel={saved ? copy.connectivityOfflineWithCopy : copy.connectivityOffline}
              copy={{
                online: copy.connectivityOnline,
                onlineTitle: copy.connectivityOnlineTitle,
                offlineTitle: copy.connectivityOfflineTitle,
              }}
            />
            {freshness ? (
              <span
                className={
                  freshness === "current"
                    ? "inline-flex min-h-9 items-center rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-sm font-bold text-success"
                    : freshness === "aging"
                      ? "inline-flex min-h-9 items-center rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-bold text-warning"
                      : "inline-flex min-h-9 items-center rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm font-bold text-danger"
                }
              >
                {freshnessLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-medium" aria-live="polite">
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
            <a
              href={`/offline-manifest?trip=${tripId}`}
              className={buttonClass({ variant: "primary", size: "boat" })}
            >
              {copy.openOfflineRollCall}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
