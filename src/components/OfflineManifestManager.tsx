"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
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

// Polling, not push — see ADR 20260726 for why this stays a five-minute
// interval (plus reconnect/visibility triggers) rather than a WebSocket/SSE
// channel for now.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function OfflineManifestManager({ payload }: { payload: OfflineManifestPayload }) {
  const router = useRouter();
  const tripId = payload.manifests[0]?.trip.id ?? "";
  const [saved, setSaved] = useState<OfflineManifestEnvelope | null>(null);
  const [message, setMessage] = useState("Checking this device…");
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
  // Tracks the pending-event count as of the *last* reconcile, so a reconcile
  // only narrates/refreshes when something actually changed this round —
  // otherwise, once a device has ever recorded any event (even one long since
  // applied), "events.length > 0" would stay true forever and every
  // background reconcile would call router.refresh(), whose fresh payload
  // re-triggers the effect below, which reconciles again: an unbounded loop.
  const lastPendingCount = useRef(0);
  // Set right before a manual "Refresh now" (or router.refresh() call below)
  // whose resulting save should show the loud confirmation instead of
  // passing silently, since the save itself only happens once the refreshed
  // payload actually lands as a prop (see the payload effect).
  const manualRefreshPending = useRef(false);

  const reconcile = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    const pendingBefore = lastPendingCount.current;
    try {
      const envelope = await syncOfflineManifest(tripId);
      if (envelope) {
        setSaved(envelope);
        const rejected = envelope.events.filter((event) => event.syncStatus === "rejected").length;
        const pending = envelope.events.filter((event) => event.syncStatus === "pending").length;
        lastPendingCount.current = pending;
        // Only narrate/refresh the live page when there was something to
        // resolve this round (pending before, or still rejected now) — a
        // snapshot with only long-applied events stays silent forever after.
        if (pendingBefore > 0 || rejected > 0) {
          setMessage(
            rejected > 0
              ? `${rejected} offline change${rejected === 1 ? " didn't" : "s didn't"} match the live manifest and ${rejected === 1 ? "wasn't" : "weren't"} applied — open the live manifest to sort it out.`
              : pending > 0
                ? `${pending} offline change${pending === 1 ? " is" : "s are"} still waiting to send.`
                : "Offline roll call is all caught up with the live manifest.",
          );
          router.refresh();
        }
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Couldn't reach DiveDay just now — your offline changes are still saved here and will try to send again on reconnect.",
      );
    }
  }, [router, tripId]);

  const save = useCallback(
    async (opts: { silent: boolean }) => {
      if (!tripId) return;
      if (inFlight.current) return inFlight.current;
      const run = (async () => {
        if (!opts.silent) {
          setBusy(true);
          setMessage("Saving the latest manifest to this device…");
        }
        try {
          await primeOfflineManifestShell();
          const envelope = await saveOfflineManifest(payloadRef.current);
          setSaved(envelope);
          lastPendingCount.current = envelope.events.filter(
            (event) => event.syncStatus === "pending",
          ).length;
          // Settled message either way — a silent background save still needs
          // to land on something other than the initial "Checking…" text.
          setMessage("This device has an up-to-date offline copy.");
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "This device couldn't save the manifest. It'll try again once you have signal.",
          );
        } finally {
          if (!opts.silent) setBusy(false);
        }
      })();
      inFlight.current = run;
      try {
        await run;
      } finally {
        inFlight.current = null;
      }
    },
    [tripId],
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
      // just resolve" check compares against a stale 0 once connectivity
      // returns, on a device that already had pending events from before.
      lastPendingCount.current =
        envelope?.events.filter((event) => event.syncStatus === "pending").length ?? 0;
      if (navigator.onLine) {
        const manual = manualRefreshPending.current;
        manualRefreshPending.current = false;
        await save({ silent: !manual });
        if (cancelled) return;
        await reconcile();
      } else {
        setMessage(
          envelope
            ? "Offline — showing the last saved copy."
            : "No offline copy on this device yet.",
        );
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
        if (opts.manual) setMessage("No signal — showing the last saved copy.");
        return;
      }
      if (opts.manual) {
        manualRefreshPending.current = true;
        setBusy(true);
        setMessage("Saving the latest manifest to this device…");
      }
      router.refresh();
      void reconcile();
    },
    [router, reconcile],
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

  const pending = saved?.events.filter((event) => event.syncStatus === "pending").length ?? 0;
  const rejected = saved?.events.filter((event) => event.syncStatus === "rejected").length ?? 0;
  const freshness = saved ? offlineManifestFreshness(new Date(saved.snapshot.savedAt)) : null;
  const freshnessLabel =
    freshness === "current" ? "Fresh copy" : freshness === "aging" ? "Aging copy" : "Stale copy";

  return (
    <section
      className="mt-5 rounded-xl border border-border bg-surface p-4 print:hidden"
      aria-labelledby="offline-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="offline-heading" className="font-semibold">
            Offline safety copy
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            This device keeps an offline copy of the manifest up to date automatically while you
            have signal. Roll call keeps working offline, and every change is double-checked against
            the live manifest once you&apos;re back.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ConnectivityStatus offlineLabel={saved ? "No signal · device copy" : "No signal"} />
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
              Saved {new Date(saved.snapshot.savedAt).toLocaleString()} · {pending} waiting to send
              · {rejected} need a look
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => refresh({ manual: true })}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 py-2.5 font-semibold hover:bg-surface-sunken disabled:opacity-60"
          >
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
          {saved ? (
            <a
              href={`/offline-manifest?trip=${tripId}`}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              Open offline roll call
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
