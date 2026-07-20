"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectivityStatus } from "@/components/ConnectivityStatus";
import { controlClass } from "@/components/ui/form";
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
  const searchParams = useSearchParams();
  const [envelope, setEnvelope] = useState<OfflineManifestEnvelope | null>(null);
  const [checkpoint, setCheckpoint] = useState<RollCallCheckpoint>("departure");
  const [message, setMessage] = useState("Opening encrypted device copy…");
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [noteByBooking, setNoteByBooking] = useState<Record<string, string>>({});
  const tripId = useMemo(() => searchParams.get("trip") ?? "", [searchParams]);

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
      <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
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
  const rollCallComplete = manifest.summary.totalDivers > 0 && awaiting === 0;

  async function record(bookingId: string, status: "boarded" | "not_boarded", note = "") {
    setBusyBooking(bookingId);
    try {
      const next = await appendOfflineRollCall(tripId, {
        bookingId,
        checkpoint,
        status,
        note: note.trim() || null,
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
    <main className="boat-mode mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <a
        href="#offline-roll-call"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground"
      >
        Skip to offline roll call
      </a>
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ConnectivityStatus />
            <span
              className={
                freshness === "current"
                  ? "rounded-full border border-success/30 bg-success/10 px-3 py-2 text-sm font-bold text-success"
                  : freshness === "aging"
                    ? "rounded-full border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-bold text-warning"
                    : "rounded-full border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger"
              }
            >
              {freshness} device snapshot
            </span>
          </div>
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
                ? "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                : "inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border-strong px-4 font-semibold"
            }
          >
            {rollCallCheckpointLabel(value)}
          </button>
        ))}
      </nav>

      <section
        className={
          rollCallComplete
            ? "rise-in mt-4 grid grid-cols-3 gap-3 rounded-2xl border border-accent/50 bg-accent/10 p-3"
            : "mt-4 grid grid-cols-3 gap-3"
        }
      >
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
        <h2 className="text-xl font-semibold">
          {rollCallComplete
            ? "Roll call complete ✦"
            : `${rollCallCheckpointLabel(checkpoint)} roll call`}
        </h2>
        {rollCallComplete ? (
          <p className="mt-1 text-sm font-semibold text-muted" role="status" aria-live="polite">
            Everyone has an explicit result for this checkpoint.
          </p>
        ) : null}
        <ul
          id="offline-roll-call"
          className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface"
        >
          {manifest.divers.map((diver, index) => {
            const state = latestOfflineRollCall(
              envelope.snapshot,
              envelope.events,
              diver.bookingId,
              checkpoint,
            );
            const ready = diver.readiness.status === "ready";
            return (
              <li
                key={diver.bookingId}
                id={`offline-roll-call-${diver.bookingId}`}
                className={
                  ready
                    ? state
                      ? "border-l-4 border-success p-4 sm:p-5"
                      : "border-l-4 border-warning bg-warning/10 p-4 ring-1 ring-inset ring-warning/30 sm:p-5"
                    : "scroll-mt-24 border-l-4 border-danger bg-danger/5 p-4 sm:p-5"
                }
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-sm font-bold tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
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
                    <div className="mt-3 grid gap-2 text-base sm:grid-cols-2">
                      <p>
                        <span className="font-bold">Emergency contact</span>
                        <span className="mt-0.5 block text-muted">
                          {diver.emergencyContactName ?? "Not on file"}
                          {diver.emergencyContactPhone ? ` · ${diver.emergencyContactPhone}` : ""}
                        </span>
                      </p>
                      <p>
                        <span className="font-bold">Rental fit</span>
                        <span className="mt-0.5 block text-muted">
                          {diver.rentalFit.text}
                          {diver.nitroxRequested ? " · Nitrox requested" : ""}
                        </span>
                      </p>
                    </div>
                    {!ready ? (
                      <ul className="mt-2 text-sm text-danger">
                        {diver.readiness.blockers.map((blocker) => (
                          <li key={blocker.message}>• {blocker.message}</li>
                        ))}
                      </ul>
                    ) : null}
                    <details className="mt-3 max-w-xl rounded-xl border border-border/70 bg-surface-sunken/50 p-3">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-primary">
                        Add a note to this roll-call record
                      </summary>
                      <div className="mt-2">
                        <label
                          htmlFor={`offline-roll-call-note-${diver.bookingId}`}
                          className="text-sm font-semibold"
                        >
                          Optional note
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
                          placeholder="Late to the boat, medical question, kit issue…"
                          className={`${controlClass} mt-1`}
                        />
                        <p className="mt-1 text-xs text-muted">
                          This stays encrypted with the pending event.
                        </p>
                      </div>
                    </details>
                  </div>
                  <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
                    {ready ? (
                      <button
                        type="button"
                        disabled={busyBooking === diver.bookingId}
                        onClick={() =>
                          record(diver.bookingId, "boarded", noteByBooking[diver.bookingId])
                        }
                        aria-busy={busyBooking === diver.bookingId}
                        className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                      >
                        {busyBooking === diver.bookingId
                          ? "Saving…"
                          : state?.state === "boarded"
                            ? "Boarded ✓"
                            : "Mark boarded"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyBooking === diver.bookingId}
                      onClick={() =>
                        record(diver.bookingId, "not_boarded", noteByBooking[diver.bookingId])
                      }
                      aria-busy={busyBooking === diver.bookingId}
                      className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-lg border border-border-strong px-5 text-base font-semibold transition-[transform,opacity] active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
                    >
                      {busyBooking === diver.bookingId
                        ? "Saving…"
                        : state?.state === "not_boarded"
                          ? "Not boarded ✓"
                          : "Mark not boarded"}
                    </button>
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
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
        >
          Open live manifest
        </a>
        <button
          type="button"
          onClick={remove}
          className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-danger hover:bg-danger/10"
        >
          Delete device copy
        </button>
      </footer>
    </main>
  );
}
