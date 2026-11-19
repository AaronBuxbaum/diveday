import { useState } from "react";
import {
  completeOfflineRollCallConfirmation,
  discardOfflineRollCallReview,
  loadOfflineManifest,
  prepareOfflineRollCallConfirmation,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestPayload, OfflineRollCallEvent } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";

/** A held observation is evidence, not a live mark. Every live mark requires an explicit choice. */
export function ReviewObservation({
  event,
  controls,
}: {
  event: OfflineRollCallEvent;
  controls: OfflineTripControls;
}) {
  const { t, reviewTenant, onReviewEnvelope } = controls;
  const [current, setCurrent] = useState<OfflineManifestPayload | null>(null);
  const [status, setStatus] = useState<"boarded" | "not_boarded" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  if (!reviewTenant || !onReviewEnvelope) return null;

  async function loadCurrent() {
    setBusy(true);
    setError(false);
    try {
      const tenant = await reviewTenant?.();
      if (!tenant) throw new Error("tenant unavailable");
      const response = await fetch(
        `/api/offline-manifests/review?tripId=${encodeURIComponent(event.tripId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("review unavailable");
      const body = (await response.json()) as { current?: OfflineManifestPayload };
      if (!body.current || body.current.shop.slug !== tenant.shopSlug)
        throw new Error("tenant changed");
      setCurrent(body.current);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const selected = event.reviewConfirmation?.status ?? status;
    const checkpointManifest = current?.manifests.find(
      (entry) => entry.checkpoint === event.checkpoint,
    );
    const person = checkpointManifest?.divers.find((diver) => diver.bookingId === event.bookingId);
    const witness = current?.rollCallWitnesses?.[`seat:${event.bookingId}:${event.checkpoint}`];
    if (!selected || !event.bookingId) return;
    if (!event.reviewConfirmation && (!person || !current?.snapshotId || !witness)) return;
    setBusy(true);
    setError(false);
    try {
      const tenant = await reviewTenant?.();
      if (!tenant || (current && current.shop.slug !== tenant.shopSlug))
        throw new Error("tenant changed");
      let prepared: {
        confirmationId: string;
        context: { snapshotId: string; meetingDay: number; witness: string };
      };
      if (event.reviewConfirmation) {
        prepared = {
          confirmationId: event.reviewConfirmation.clientEventId,
          context: event.reviewConfirmation.context,
        };
      } else {
        if (!current?.snapshotId || !witness) throw new Error("current context unavailable");
        prepared = await prepareOfflineRollCallConfirmation(
          event.tripId,
          event.clientEventId,
          selected,
          tenant.shopSlug,
          tenant.round,
          { snapshotId: current.snapshotId, meetingDay: current.rollCallMeetingDay ?? 0, witness },
        );
        const retained = await loadOfflineManifest(event.tripId);
        if (retained) onReviewEnvelope?.(retained);
      }
      const response = await fetch("/api/offline-manifests/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId: event.tripId,
          bookingId: event.bookingId,
          checkpoint: event.checkpoint,
          status: selected,
          ...prepared.context,
          confirmationId: prepared.confirmationId,
          confirmed: true,
        }),
      });
      const receipt: unknown = await response.json();
      if (
        !response.ok ||
        !receipt ||
        typeof receipt !== "object" ||
        !("confirmationId" in receipt) ||
        receipt.confirmationId !== prepared.confirmationId ||
        !("status" in receipt) ||
        (receipt.status !== "applied" && receipt.status !== "duplicate")
      )
        throw new Error("confirmation unavailable");
      const next = await completeOfflineRollCallConfirmation(
        event.tripId,
        event.clientEventId,
        prepared.confirmationId,
        tenant.shopSlug,
        tenant.round,
      );
      onReviewEnvelope?.(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    setError(false);
    try {
      const tenant = await reviewTenant?.();
      if (!tenant) throw new Error("tenant unavailable");
      const next = await discardOfflineRollCallReview(
        event.tripId,
        event.clientEventId,
        tenant.shopSlug,
        tenant.round,
      );
      onReviewEnvelope?.(next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const manifest = current?.manifests.find((entry) => entry.checkpoint === event.checkpoint);
  const person = manifest?.divers.find((diver) => diver.bookingId === event.bookingId);
  return (
    <div className="mt-2 space-y-2 text-foreground">
      <button type="button" disabled={busy} onClick={() => void loadCurrent()}>
        {t("shared.offlineManifest.single.reviewLoad")}
      </button>
      {current && manifest && (
        <div>
          <p>
            {t("shared.offlineManifest.single.reviewCurrentTrip", {
              trip: manifest.trip.title,
              startsAt: manifest.trip.startsAt,
            })}
          </p>
          <p>{t("shared.offlineManifest.single.reviewCurrentRoster")}</p>
          <ul>
            {manifest.divers.map((diver) => (
              <li key={diver.bookingId}>
                {diver.fullName} —{" "}
                {t(
                  diver.rollCall?.state === "boarded"
                    ? "shared.presence.boarded"
                    : diver.rollCall?.state === "not_boarded"
                      ? event.checkpoint === "departure"
                        ? "shared.presence.notBoarded"
                        : "shared.offlineManifest.single.notBackAboardActive"
                      : "shared.offlineManifest.single.reviewAwaiting",
                )}
              </li>
            ))}
          </ul>
          {person &&
          event.bookingId &&
          current.rollCallWitnesses?.[`seat:${event.bookingId}:${event.checkpoint}`] ? (
            <div>
              <p>
                {t("shared.offlineManifest.single.reviewVerifyPerson", { name: person.fullName })}
              </p>
              {!event.reviewConfirmation && (
                <fieldset>
                  <legend>{t("shared.offlineManifest.single.reviewChoose")}</legend>
                  <label>
                    <input
                      type="radio"
                      name={`review-${event.clientEventId}`}
                      checked={status === "boarded"}
                      onChange={() => setStatus("boarded")}
                    />
                    {t("shared.presence.boarded")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`review-${event.clientEventId}`}
                      checked={status === "not_boarded"}
                      onChange={() => setStatus("not_boarded")}
                    />
                    {t(event.checkpoint === "departure" ? "shared.presence.notBoarded" : "shared.offlineManifest.single.notBackAboardActive")}
                  </label>
                </fieldset>
              )}
              {!event.reviewConfirmation && (
                <button type="button" disabled={busy || !status} onClick={() => void confirm()}>
                  {t("shared.offlineManifest.single.reviewConfirm")}
                </button>
              )}
            </div>
          ) : (
            <p>{t("shared.offlineManifest.single.reviewNoMatch")}</p>
          )}
        </div>
      )}
      {event.reviewConfirmation && (
        <button type="button" disabled={busy} onClick={() => void confirm()}>
          {t("shared.offlineManifest.single.reviewRetry")}
        </button>
      )}
      {!event.reviewConfirmation &&
        (discarding ? (
          <button type="button" disabled={busy} onClick={() => void discard()}>
            {t("shared.offlineManifest.single.reviewDiscardConfirm")}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => setDiscarding(true)}>
            {t("shared.offlineManifest.single.reviewDiscard")}
          </button>
        ))}
      {error && <p role="alert">{t("shared.offlineManifest.single.reviewFailed")}</p>}
    </div>
  );
}
