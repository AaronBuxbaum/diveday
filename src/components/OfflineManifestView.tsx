"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type RollCallCheckpoint,
  rollCallCheckpointLabel,
  rollCallCheckpoints,
} from "@/lib/manifests";
import {
  appendOfflineRollCall,
  deleteOfflineManifest,
  loadOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import {
  latestOfflineRollCall,
  type OfflineManifestEnvelope,
  offlineManifestFreshness,
} from "@/lib/offline-manifests";

const FRESHNESS_COPY = {
  current: "Current device copy",
  aging: "Aging device copy — compare with the live manifest when service returns",
  stale: "Stale device copy — use visible caution and reconcile before relying on it again",
} as const;

export function OfflineManifestView() {
  const [envelope, setEnvelope] = useState<OfflineManifestEnvelope | null>(null);
  const [checkpoint, setCheckpoint] = useState<RollCallCheckpoint>("departure");
  const [message, setMessage] = useState("Opening encrypted device copy…");
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const tripId = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : (new URLSearchParams(window.location.search).get("trip") ?? ""),
    [],
  );

  const reconcile = useCallback(async () => {
    if (!tripId || !navigator.onLine) return;
    try {
      const next = await syncOfflineManifest(tripId);
      if (!next) return;
      setEnvelope(next);
      const rejected = next.events.filter((event) => event.syncStatus === "rejected").length;
      const pending = next.events.filter((event) => event.syncStatus === "pending").length;
      setMessage(
        rejected > 0
          ? `${rejected} change${rejected === 1 ? " conflicts" : "s conflict"} with live safety data. Open the live manifest to review.`
          : pending > 0
            ? `${pending} change${pending === 1 ? " is" : "s are"} still waiting to sync.`
            : "All offline changes are reconciled with the live manifest.",
      );
    } catch {
      setMessage("Still using the device copy. Reconciliation will retry when Scuba is reachable.");
    }
  }, [tripId]);

  useEffect(() => {
    if (!tripId) {
      setMessage("No trip was selected. Open offline roll call from a live manifest first.");
      return;
    }
    loadOfflineManifest(tripId)
      .then((saved) => {
        setEnvelope(saved);
        setMessage(
          saved
            ? "Encrypted device copy is ready."
            : "No unexpired manifest is saved for this trip.",
        );
        if (saved && navigator.onLine) void reconcile();
      })
      .catch(() => setMessage("This device could not decrypt the saved manifest."));
    window.addEventListener("online", reconcile);
    return () => window.removeEventListener("online", reconcile);
  }, [reconcile, tripId]);

  if (!envelope) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">
          Offline manifest
        </p>
        <h1 className="mt-3 text-3xl font-semibold">No device copy available</h1>
        <p className="mt-3 text-muted" role="status">
          {message}
        </p>
      </main>
    );
  }

  const manifest =
    envelope.snapshot.manifests.find((entry) => entry.checkpoint === checkpoint) ??
    envelope.snapshot.manifests[0];
  if (!manifest) return null;
  const freshness = offlineManifestFreshness(new Date(envelope.snapshot.savedAt));
  const pending = envelope.events.filter((event) => event.syncStatus === "pending").length;
  const rejected = envelope.events.filter((event) => event.syncStatus === "rejected").length;
  const localStates = manifest.divers.map((diver) =>
    latestOfflineRollCall(envelope.snapshot, envelope.events, diver.bookingId, checkpoint),
  );
  const boarded = localStates.filter((state) => state?.state === "boarded").length;
  const awaiting = localStates.filter((state) => !state).length;

  async function record(bookingId: string, status: "boarded" | "not_boarded") {
    setBusyBooking(bookingId);
    try {
      const next = await appendOfflineRollCall(tripId, {
        bookingId,
        checkpoint,
        status,
        note: null,
      });
      setEnvelope(next);
      setMessage("Saved on this device · waiting to sync.");
      if (navigator.onLine) await reconcile();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "That offline change could not be saved.",
      );
    } finally {
      setBusyBooking(null);
    }
  }

  async function remove() {
    await deleteOfflineManifest(tripId);
    setEnvelope(null);
    setMessage("Offline copy deleted from this device.");
  }

  const dateTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: envelope.snapshot.shop.timezone,
  });

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-widest text-primary uppercase">
              Offline manifest
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{manifest.trip.title}</h1>
            <p className="mt-1 text-base text-muted">
              Saved {dateTime.format(new Date(envelope.snapshot.savedAt))}
            </p>
          </div>
          <span className="rounded-full bg-warning/10 px-3 py-2 text-sm font-semibold text-warning">
            Device copy · {freshness}
          </span>
        </div>
        <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-base leading-6">
          {FRESHNESS_COPY[freshness]}. Boarding uses readiness as saved; live readiness is checked
          again during sync.
        </p>
        <p className="mt-3 text-sm font-medium" role="status" aria-live="polite">
          {message}
        </p>
        <p className="mt-1 text-sm text-muted">
          {pending} pending · {rejected} conflicts
        </p>
      </header>

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-2" aria-label="Roll-call checkpoint">
        {rollCallCheckpoints(manifest.trip.plannedDives).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setCheckpoint(value)}
            className={
              value === checkpoint
                ? "min-h-11 shrink-0 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                : "min-h-11 shrink-0 rounded-lg border border-border-strong px-4 font-semibold"
            }
          >
            {rollCallCheckpointLabel(value)}
          </button>
        ))}
      </nav>

      <section className="mt-4 grid grid-cols-3 gap-3">
        {[
          ["Divers", manifest.summary.totalDivers],
          ["Boarded", boarded],
          ["Awaiting", awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs font-semibold text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">{rollCallCheckpointLabel(checkpoint)} roll call</h2>
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
          {manifest.divers.map((diver) => {
            const state = latestOfflineRollCall(
              envelope.snapshot,
              envelope.events,
              diver.bookingId,
              checkpoint,
            );
            const ready = diver.readiness.status === "ready";
            return (
              <li key={diver.bookingId} className="p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{diver.fullName}</h3>
                      <span
                        className={
                          ready
                            ? "rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success"
                            : "rounded-full bg-danger/10 px-3 py-1 text-sm font-semibold text-danger"
                        }
                      >
                        {ready ? "Ready in snapshot" : "Blocked in snapshot"}
                      </span>
                      <span className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold">
                        {state
                          ? state.state === "boarded"
                            ? "Boarded"
                            : "Not boarded"
                          : "Awaiting roll call"}
                        {state?.pending ? " · pending sync" : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-base text-muted">
                      Emergency contact: {diver.emergencyContactName ?? "not on file"}
                      {diver.emergencyContactPhone ? ` · ${diver.emergencyContactPhone}` : ""}
                    </p>
                    {!ready ? (
                      <ul className="mt-2 text-sm text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.message}>• {blocker.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {ready && state?.state !== "boarded" ? (
                      <button
                        type="button"
                        disabled={busyBooking === diver.bookingId}
                        onClick={() => record(diver.bookingId, "boarded")}
                        className="min-h-14 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        Mark boarded
                      </button>
                    ) : null}
                    {state?.state !== "not_boarded" ? (
                      <button
                        type="button"
                        disabled={busyBooking === diver.bookingId}
                        onClick={() => record(diver.bookingId, "not_boarded")}
                        className="min-h-14 rounded-lg border border-border-strong px-5 text-base font-semibold disabled:opacity-60"
                      >
                        Mark not boarded
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-5">
        <a
          href={`/shop/${envelope.snapshot.shop.slug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`}
          className="min-h-11 rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
        >
          Open live manifest
        </a>
        <button
          type="button"
          onClick={remove}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-danger hover:bg-danger/10"
        >
          Delete device copy
        </button>
      </footer>
    </main>
  );
}
