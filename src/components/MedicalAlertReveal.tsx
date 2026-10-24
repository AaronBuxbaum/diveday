"use client";

import { useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { loadOfflineManifest } from "@/lib/offline-manifest-store";

export type MedicalAlertResult = { ok: true; text: string } | { ok: false };

export type MedicalAlertRevealCopy = {
  show: string;
  showing: string;
  /** Says the tap is recorded before anyone makes it. */
  showHint: string;
  /** The server answered and refused. */
  failed: string;
  /** Under the words, wherever staff read them: the diver's, unreviewed, never a gate. */
  notReviewed: string;
  /** No signal and no copy saved with the words (`savedCopy` callers only). */
  noSignal?: string;
  /** `{name}`: who saved the copy the words came from (`savedCopy` callers only). */
  fromSavedCopy?: string;
};

/**
 * The emergency read's words (issue #2990): offered under `unreadable` to a
 * staffer the crew rule refuses, on the day of the departure only.
 */
export type MedicalAlertEmergencyCopy = {
  /** "Emergency: show the alert". */
  offer: string;
  /** The confirm step: for emergencies only, and the owner will see it. */
  confirmBody: string;
  confirm: string;
  cancel: string;
  /** No signal: an emergency read needs the server, and nothing is offered offline. */
  noSignal: string;
};

type Revealed = { text: string; savedBy?: string };

/**
 * The words revealed in this visit, by `keepAs`, so closing and reopening a
 * sheet shows them again without a second call or a second read on the
 * diver's trail. Module state, so a full reload starts empty, and
 * `forgetThisDevice` empties it on sign-out for the next person.
 */
const revealedThisVisit = new Map<string, Revealed>();

/** Forgets every alert revealed in this visit (sign-out, `forgetThisDevice`). */
export function forgetRevealedMedicalAlerts(): void {
  revealedThisVisit.clear();
}

/**
 * The words for one seat from a copy this device saved **with** them (an
 * explicit save, `saveOfflineMedicalAlerts`), or null. Never throws: this is
 * the no-signal path.
 */
async function savedWords(seat: { tripId: string; bookingId: string }): Promise<Revealed | null> {
  try {
    const envelope = await loadOfflineManifest(seat.tripId);
    const savedBy = envelope?.medicalAlertsSavedBy;
    if (!envelope || !savedBy) return null;
    for (const manifest of envelope.snapshot.manifests) {
      for (const diver of manifest.divers) {
        const text = diver.bookingId === seat.bookingId ? diver.medicalAlert?.text : undefined;
        if (text) return { text, savedBy: savedBy.name };
      }
    }
  } catch {
    // No IndexedDB, or an unreadable record: nothing saved to show.
  }
  return null;
}

/**
 * **A diver's medical alert for the crew, read on purpose** (glossary
 * *Medical alert for the crew*, issue #2960, H-153). At rest it shows nothing
 * of what the alert says, and the page that renders it carries none of the
 * words either: they leave the server only through `show`, whose action
 * checks the reader and writes the read to the diver's trail first
 * (`showSeatMedicalAlertAction` on the manifest,
 * `showMedicalAlertOnRecordAction` on the signed record). Anyone else reads
 * `unreadable`: that one exists, who can read it, and whom to ask.
 *
 * **It never takes the page down** (domain review 2, B1; the pattern of
 * `MissingReportButton`). A call that fails, or a device with the radio off,
 * falls back to a copy this phone saved with the words (`savedCopy`), shown
 * with who saved it; with none, it says there is no signal and to save the
 * trip for offline before leaving the dock. Nothing is thrown to `error.tsx`.
 */
export function MedicalAlertReveal({
  show,
  unreadable,
  copy,
  keepAs,
  savedCopy,
  emergency,
}: {
  /** The bound action, for a reader allowed the words here. */
  show?: () => Promise<MedicalAlertResult>;
  /** Said instead of a button to a reader who may not read it. */
  unreadable: string;
  copy: MedicalAlertRevealCopy;
  /** Keeps revealed words for this visit under this key (see `revealedThisVisit`). */
  keepAs?: string;
  /** The seat on this device's saved copies, for the no-signal fallback. */
  savedCopy?: { tripId: string; bookingId: string };
  /**
   * "Emergency: show the alert" (issue #2990), bound only for a staffer the
   * crew rule refuses on the day of the departure; absent everywhere else,
   * offline copies and bearer pages included. Its words are never kept for
   * the visit: every reopen asks, confirms and records again.
   */
  emergency?: { show: () => Promise<MedicalAlertResult>; copy: MedicalAlertEmergencyCopy };
}) {
  const [revealed, setRevealed] = useState<Revealed | null>(() =>
    keepAs ? (revealedThisVisit.get(keepAs) ?? null) : null,
  );
  const [problem, setProblem] = useState<"failed" | "no_signal" | null>(null);
  const [pending, startTransition] = useTransition();

  if (revealed) {
    return (
      <div className="flex flex-col gap-1">
        {/* The diver's own words, line breaks kept: "Bee-sting allergy.\nEpiPen
            in the blue dry bag." */}
        <p className="text-base whitespace-pre-wrap [overflow-wrap:anywhere]">{revealed.text}</p>
        {revealed.savedBy && copy.fromSavedCopy ? (
          <p className="text-xs text-muted">
            {fill(copy.fromSavedCopy, { name: revealed.savedBy })}
          </p>
        ) : null}
        <p className="text-xs text-muted">{copy.notReviewed}</p>
      </div>
    );
  }
  if (!show) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted">{unreadable}</p>
        {emergency ? (
          <EmergencyRead
            show={emergency.show}
            copy={emergency.copy}
            showing={copy.showing}
            failed={copy.failed}
            onRead={(text) => {
              setProblem(null);
              setRevealed({ text });
            }}
          />
        ) : null}
      </div>
    );
  }

  const keep = (words: Revealed) => {
    if (keepAs) revealedThisVisit.set(keepAs, words);
    setProblem(null);
    setRevealed(words);
  };
  const fromThisPhone = async () => {
    const saved = savedCopy ? await savedWords(savedCopy) : null;
    if (saved) keep(saved);
    else setProblem(savedCopy && copy.noSignal ? "no_signal" : "failed");
  };
  const reveal = () =>
    startTransition(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await fromThisPhone();
        return;
      }
      try {
        const result = await show();
        if (result.ok) keep({ text: result.text });
        else setProblem("failed");
      } catch {
        // A server-action fetch that never reached the server: no signal.
        await fromThisPhone();
      }
    });

  return (
    <div className="flex flex-col items-start gap-1 print:hidden">
      <button
        type="button"
        onClick={reveal}
        disabled={pending}
        aria-busy={pending}
        className={buttonClass({ variant: "secondary", size: "sm", busy: true })}
      >
        {pending ? copy.showing : copy.show}
      </button>
      <p className="text-xs text-muted">{copy.showHint}</p>
      {problem ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {problem === "no_signal" ? copy.noSignal : copy.failed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * **"Emergency: show the alert", then a confirm step** (issue #2990, H-153
 * amendment of 2026-10-24). The first tap only asks: it says this is for
 * emergencies and that the owner will see it. The confirm calls the server,
 * which checks the reader again and records the read before it answers.
 * Never offline: with the radio off it says so and calls nothing. A failed
 * call says so and never throws to the page.
 */
function EmergencyRead({
  show,
  copy,
  showing,
  failed,
  onRead,
}: {
  show: () => Promise<MedicalAlertResult>;
  copy: MedicalAlertEmergencyCopy;
  showing: string;
  failed: string;
  onRead: (text: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<"failed" | "no_signal" | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setProblem("no_signal");
        return;
      }
      try {
        const result = await show();
        if (result.ok) onRead(result.text);
        else setProblem("failed");
      } catch {
        // A server-action fetch that never reached the server.
        setProblem("no_signal");
      }
    });
  return (
    <div className="flex flex-col items-start gap-2 print:hidden">
      {confirming ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-sm font-medium">{copy.confirmBody}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              aria-busy={pending}
              className={buttonClass({ variant: "primary", size: "sm", busy: true })}
            >
              {pending ? showing : copy.confirm}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setProblem(null);
              }}
              disabled={pending}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.offer}
        </button>
      )}
      {problem ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {problem === "no_signal" ? copy.noSignal : failed}
        </p>
      ) : null}
    </div>
  );
}
