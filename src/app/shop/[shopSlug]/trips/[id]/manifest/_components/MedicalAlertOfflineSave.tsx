"use client";

import { useEffect, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import {
  beginOfflineTenantVerificationRound,
  loadOfflineManifest,
  saveOfflineMedicalAlerts,
} from "@/lib/offline-manifest-store";
import type { OfflineMedicalAlertsResponse } from "@/lib/offline-manifests";

export type MedicalAlertOfflineSaveCopy = {
  heading: string;
  body: string;
  button: string;
  saving: string;
  /** `{name}`: who saved the words onto this phone's copy. */
  done: string;
  noCopy: string;
  failed: string;
};

/** The route's answer, checked rather than cast. */
function parsed(body: unknown): OfflineMedicalAlertsResponse | null {
  const { texts, savedBy } = (body ?? {}) as Partial<OfflineMedicalAlertsResponse>;
  if (!texts || typeof texts !== "object") return null;
  if (!savedBy || typeof savedBy.personId !== "string" || typeof savedBy.name !== "string") {
    return null;
  }
  const words: Record<string, string> = {};
  for (const [bookingId, text] of Object.entries(texts)) {
    if (typeof text === "string" && text !== "") words[bookingId] = text;
  }
  return { texts: words, savedBy };
}

/**
 * **"Save the medical alerts for offline"** (H-153 amendment, issue #2960):
 * the one way a diver's medical alert words reach this phone. Offered only to
 * a reader allowed them on this departure (the owner, a manager, or crew a
 * manager put on it), inside the manifest's "On this phone" group. The tap
 * asks `POST /api/offline-manifests/[tripId]/medical-alerts`, which records
 * the save on each diver's trail, then puts the words on the copy this phone
 * already holds, with who saved them. Background saves never carry words; they
 * keep the ones saved here until sign-out, or until another person signs in.
 */
export function MedicalAlertOfflineSave({
  tripId,
  copy,
}: {
  tripId: string;
  copy: MedicalAlertOfflineSaveCopy;
}) {
  const [savedBy, setSavedBy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadOfflineManifest(tripId)
      .then((envelope) => {
        if (!cancelled) setSavedBy(envelope?.medicalAlertsSavedBy?.name ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const save = () =>
    startTransition(async () => {
      try {
        const held = await loadOfflineManifest(tripId).catch(() => null);
        if (!held) {
          setProblem(copy.noCopy);
          return;
        }
        const tenantRound = await beginOfflineTenantVerificationRound();
        const response = await fetch(`/api/offline-manifests/${tripId}/medical-alerts`, {
          method: "POST",
          credentials: "same-origin",
        });
        const answer = response.ok ? parsed(await response.json()) : null;
        if (!answer) {
          setProblem(copy.failed);
          return;
        }
        const saved = await saveOfflineMedicalAlerts(
          tripId,
          answer.texts,
          answer.savedBy,
          tenantRound,
        );
        setProblem(null);
        setSavedBy(saved?.medicalAlertsSavedBy?.name ?? null);
      } catch {
        setProblem(copy.failed);
      }
    });

  return (
    <div className="rounded-inset bg-surface-sunken/70 p-4">
      <h3 className="font-semibold">{copy.heading}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{copy.body}</p>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        aria-busy={pending}
        className={buttonClass({
          variant: "secondary",
          size: "boat",
          className: "mt-3 w-full sm:w-auto",
        })}
      >
        {pending ? copy.saving : copy.button}
      </button>
      <p className="mt-2 text-sm font-medium" aria-live="polite">
        {savedBy && !problem ? fill(copy.done, { name: savedBy }) : null}
      </p>
      {problem ? (
        <p role="alert" className="mt-1 text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
