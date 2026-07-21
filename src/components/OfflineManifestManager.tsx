"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import {
  deleteOfflineManifest,
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

export function OfflineManifestManager({ payload }: { payload: OfflineManifestPayload }) {
  const router = useRouter();
  const tripId = payload.manifests[0]?.trip.id ?? "";
  const [saved, setSaved] = useState<OfflineManifestEnvelope | null>(null);
  const [message, setMessage] = useState("Checking this device…");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tripId) return;
    const envelope = await loadOfflineManifest(tripId);
    setSaved(envelope);
    setMessage(envelope ? "Manifest saved on this device." : "No offline copy on this device yet.");
  }, [tripId]);

  const reconcile = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    try {
      const envelope = await syncOfflineManifest(tripId);
      if (envelope) {
        setSaved(envelope);
        const rejected = envelope.events.filter((event) => event.syncStatus === "rejected").length;
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
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Couldn't reach DiveDay just now — your offline changes are still saved here and will try to send again on reconnect.",
      );
    }
  }, [router, tripId]);

  useEffect(() => {
    refresh()
      .then(reconcile)
      .catch(() => setMessage("This device couldn't open its saved copy. Save a fresh one."));
    window.addEventListener("online", reconcile);
    return () => window.removeEventListener("online", reconcile);
  }, [reconcile, refresh]);

  async function save() {
    setBusy(true);
    setMessage("Saving the latest manifest to this device…");
    try {
      await primeOfflineManifestShell();
      const envelope = await saveOfflineManifest(payload);
      setSaved(envelope);
      setMessage(
        "Saved. Open the offline roll call once before you lose signal, so you know this phone has it.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "This device couldn't save the manifest. Try again while you still have signal.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteOfflineManifest(tripId);
      setSaved(null);
      setMessage("Offline copy deleted from this device.");
    } finally {
      setBusy(false);
    }
  }

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
            Save the manifest to this phone before you head out of signal. Roll call keeps working
            offline, and every change is double-checked against the live manifest once you&apos;re
            back.
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
            onClick={save}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          >
            {saved ? "Refresh offline copy" : "Save for offline"}
          </button>
          {saved ? (
            <>
              <a
                href={`/offline-manifest?trip=${tripId}`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-strong px-4 py-2.5 font-semibold hover:bg-surface-sunken"
              >
                Open offline roll call
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
              >
                Delete device copy
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
