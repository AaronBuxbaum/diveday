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
  // racing each other into IndexedDB.
  const inFlight = useRef<Promise<void> | null>(null);
  // Read via ref inside `save` (below) instead of closing over `payload`
  // directly, so `save`'s identity — and the timer effect that depends on
  // it — stays stable across a server re-render (e.g. a roll-call action's
  // revalidatePath), rather than resetting the 5-minute interval on every
  // edit made on this trip.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const reconcile = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    try {
      const envelope = await syncOfflineManifest(tripId);
      if (envelope) {
        setSaved(envelope);
        // Nothing to reconcile on a snapshot with no offline roll-call events
        // yet (the common case for an auto-save with nothing recorded
        // offline) — skip both the message and the refresh so the automatic
        // background pass stays invisible until there's something to say.
        if (envelope.events.length > 0) {
          const rejected = envelope.events.filter(
            (event) => event.syncStatus === "rejected",
          ).length;
          const pending = envelope.events.filter((event) => event.syncStatus === "pending").length;
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
  // again on every subsequent server re-render (e.g. a roll-call action's
  // revalidatePath), so a dockside edit gets captured right away instead of
  // waiting for the next interval tick. `payload` itself isn't read in this
  // closure (`save` reads it via `payloadRef`) but is listed deliberately —
  // it's the signal a fresh save is worth doing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: payload is an intentional re-run signal, see above
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    (async () => {
      const envelope = await loadOfflineManifest(tripId).catch(() => null);
      if (cancelled) return;
      setSaved(envelope);
      if (navigator.onLine) {
        await save({ silent: true });
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

  useEffect(() => {
    if (!tripId) return;
    const onOnline = () => {
      save({ silent: true }).then(reconcile);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        save({ silent: true }).then(reconcile);
      }
    };
    const interval = setInterval(() => {
      if (navigator.onLine) save({ silent: true }).then(reconcile);
    }, AUTO_REFRESH_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [tripId, save, reconcile]);

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
            onClick={() => save({ silent: false }).then(reconcile)}
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
