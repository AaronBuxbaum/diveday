import { useState } from "react";
import { ErrorToast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import { radioClass, radioRingClass } from "@/components/ui/form";
import {
  completeOfflineRollCallConfirmation,
  discardOfflineRollCallReview,
  loadOfflineManifest,
  prepareOfflineRollCallConfirmation,
  releaseOfflineRollCallConfirmation,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestPayload, OfflineRollCallEvent } from "@/lib/offline-manifests";
import type { OfflineTripControls } from "./controls";
import { ReviewRoster } from "./ReviewRoster";
import { readReviewContext } from "./read-review-context";

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
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [sameAssignment, setSameAssignment] = useState(false);
  const [status, setStatus] = useState<"boarded" | "not_boarded" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  if (!reviewTenant || !onReviewEnvelope) return null;

  async function loadCurrent() {
    setBusy(true);
    setError(false);
    setOriginalName(null);
    setSameAssignment(false);
    try {
      if (!reviewTenant) throw new Error("tenant unavailable");
      const tenant = await reviewTenant();
      if (!tenant) throw new Error("tenant unavailable");
      const current = await readReviewContext(event, tenant, reviewTenant, (name, matches) => {
        setOriginalName(name);
        setSameAssignment(matches);
      });
      setCurrent(current);
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
    if (
      !event.reviewConfirmation &&
      (!sameAssignment ||
        !event.rollCallWitness ||
        event.meetingDay === undefined ||
        !person ||
        !current?.snapshotId ||
        current.rollCallMeetingDay === undefined ||
        !witness)
    )
      return;
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
        if (!current?.snapshotId || current.rollCallMeetingDay === undefined || !witness)
          throw new Error("current context unavailable");
        prepared = await prepareOfflineRollCallConfirmation(
          event.tripId,
          event.clientEventId,
          selected,
          tenant.shopSlug,
          tenant.round,
          { snapshotId: current.snapshotId, meetingDay: current.rollCallMeetingDay, witness },
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
          originalWitness: event.rollCallWitness,
          originalSnapshotId: event.snapshotId,
          originalMeetingDay: event.meetingDay,
          confirmationId: prepared.confirmationId,
          confirmed: true,
        }),
      });
      const receipt: unknown = await response.json();
      if (
        response.status === 409 &&
        receipt &&
        typeof receipt === "object" &&
        "confirmationId" in receipt &&
        receipt.confirmationId === prepared.confirmationId &&
        "status" in receipt &&
        receipt.status === "not_applied"
      ) {
        const next = await releaseOfflineRollCallConfirmation(
          event.tripId,
          event.clientEventId,
          prepared.confirmationId,
          tenant.shopSlug,
          tenant.round,
        );
        onReviewEnvelope?.(next);
        setCurrent(null);
        setStatus(null);
        setOriginalName(null);
        setSameAssignment(false);
        throw new Error("confirmation refused");
      }
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
      <button
        type="button"
        className={buttonClass({ variant: "secondary", size: "boat" })}
        disabled={busy}
        onClick={() => void loadCurrent()}
      >
        {t("shared.offlineManifest.single.reviewLoad")}
      </button>
      {originalName && (
        <p>{t("shared.offlineManifest.single.reviewOriginalNameOnline", { name: originalName })}</p>
      )}
      {current && manifest && (
        <div className="space-y-4">
          <ReviewRoster current={current} manifest={manifest} event={event} controls={controls} />
          {person &&
          event.bookingId &&
          sameAssignment &&
          current.rollCallMeetingDay !== undefined &&
          current.rollCallWitnesses?.[`seat:${event.bookingId}:${event.checkpoint}`] ? (
            <div className="space-y-3">
              <p>
                {t("shared.offlineManifest.single.reviewVerifyPerson", { name: person.fullName })}
              </p>
              {!event.reviewConfirmation && (
                <fieldset className="space-y-2">
                  <legend className="font-semibold">
                    {t("shared.offlineManifest.single.reviewChoose")}
                  </legend>
                  <label
                    className={`flex min-h-14 items-center gap-3 rounded-lg border border-border px-4 ${radioRingClass}`}
                  >
                    <input
                      type="radio"
                      className={radioClass}
                      name={`review-${event.clientEventId}`}
                      checked={status === "boarded"}
                      onChange={() => setStatus("boarded")}
                    />
                    {t("shared.presence.boarded")}
                  </label>
                  <label
                    className={`flex min-h-14 items-center gap-3 rounded-lg border border-border px-4 ${radioRingClass}`}
                  >
                    <input
                      type="radio"
                      className={radioClass}
                      name={`review-${event.clientEventId}`}
                      checked={status === "not_boarded"}
                      onChange={() => setStatus("not_boarded")}
                    />
                    {t(
                      event.checkpoint === "departure"
                        ? "shared.presence.notBoarded"
                        : "shared.offlineManifest.single.notBackAboardActive",
                    )}
                  </label>
                </fieldset>
              )}
              {!event.reviewConfirmation && (
                <button
                  type="button"
                  className={buttonClass({ size: "boat" })}
                  disabled={busy || !status}
                  onClick={() => void confirm()}
                >
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
        <button
          type="button"
          className={buttonClass({ variant: "secondary", size: "boat" })}
          disabled={busy}
          onClick={() => void confirm()}
        >
          {t("shared.offlineManifest.single.reviewRetry")}
        </button>
      )}
      {!event.reviewConfirmation &&
        (discarding ? (
          <button
            type="button"
            className={buttonClass({ variant: "danger", size: "boat" })}
            disabled={busy}
            onClick={() => void discard()}
          >
            {t("shared.offlineManifest.single.reviewDiscardConfirm")}
          </button>
        ) : (
          <button
            type="button"
            className={buttonClass({ variant: "secondary", size: "boat" })}
            disabled={busy}
            onClick={() => setDiscarding(true)}
          >
            {t("shared.offlineManifest.single.reviewDiscard")}
          </button>
        ))}
      {error && <ErrorToast message={t("shared.offlineManifest.single.reviewFailed")} />}
    </div>
  );
}
