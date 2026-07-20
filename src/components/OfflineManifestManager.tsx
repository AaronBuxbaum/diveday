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
    setMessage(
      envelope ? "Encrypted copy saved on this device." : "No offline copy on this device yet.",
    );
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
            ? `${rejected} offline change${rejected === 1 ? " needs" : "s need"} review; the live manifest was not overwritten.`
            : pending > 0
              ? `${pending} offline change${pending === 1 ? " is" : "s are"} waiting to sync.`
              : "Offline roll call is reconciled with the live manifest.",
        );
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Offline changes could not be reconciled.",
      );
    }
  }, [router, tripId]);

  useEffect(() => {
    refresh()
      .then(reconcile)
      .catch(() => setMessage("This browser could not read its offline copy."));
    window.addEventListener("online", reconcile);
    return () => window.removeEventListener("online", reconcile);
  }, [reconcile, refresh]);

  async function save() {
    setBusy(true);
    setMessage("Encrypting the latest manifest and preparing offline mode…");
    try {
      await primeOfflineManifestShell();
      const envelope = await saveOfflineManifest(payload);
      setSaved(envelope);
      setMessage(
        "Saved. Open offline roll call once before leaving service to verify this device.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "This device could not save the manifest.",
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
    freshness === "current"
      ? "Fresh snapshot"
      : freshness === "aging"
        ? "Aging snapshot"
        : "Stale snapshot";

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
            Save an encrypted copy to this device before leaving service. It includes every
            roll-call checkpoint; changes wait here until the live manifest can verify and reconcile
            them.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ConnectivityStatus />
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
              Saved {new Date(saved.snapshot.savedAt).toLocaleString()} · {pending} pending ·{" "}
              {rejected} conflicts
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
