"use client";

import { useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { fill } from "@/i18n/fill";
import { loadOfflineManifest } from "@/lib/offline-manifest-store";

export type MedicalAlertResult =
  | { ok: true; text: string }
  /** `reason` only on the emergency read: the trip's days are not open yet, or are over. */
  | { ok: false; reason?: "not_yet" | "closed" };

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
 * staffer the crew rule refuses, until the days of the trip are over.
 */
export type MedicalAlertEmergencyCopy = {
  /** "Emergency: show the alert". */
  offer: string;
  /** The confirm step: for emergencies only, it goes on the record, and the owner will see it. */
  confirmBody: string;
  confirm: string;
  cancel: string;
  /**
   * No signal right now, offline or after {@link EMERGENCY_READ_TIMEOUT_MS}:
   * try again, or the printed sheet or a crew phone with the alerts saved.
   */
  noSignal: string;
  /** The server refused because the trip's days have not begun: it opens on the day. */
  notYet: string;
  /** Any other refusal: it can't be opened now; ask the owner or a manager. Never "Try again". */
  closed: string;
};

/**
 * How long "Show it now" waits for the server before it says there is no
 * signal right now and offers the retry (domain review 2, S2): a server
 * action on a stalled cell link can otherwise hang for a minute at the rail.
 */
export const EMERGENCY_READ_TIMEOUT_MS = 15_000;

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
   * crew rule refuses until the days of the trip are over; absent elsewhere,
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
      <div className="flex flex-col gap-1 print:hidden">
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
 * emergencies, that it goes on the diver's record and that the owner will see
 * it. The confirm calls the server, which checks the reader again and records
 * the read before it answers. The server decides: before the trip's days it
 * says the read opens on the day of the trip; after, or for any other
 * refusal, that it can't be opened now and to ask the owner or a manager.
 *
 * On weak signal it gives up after {@link EMERGENCY_READ_TIMEOUT_MS}, says
 * there is no signal right now and leaves the retry one tap away; Cancel works
 * while it waits, and an answer that arrives after a cancel or a timeout is
 * dropped. Never offline: with the radio off it says so and calls nothing.
 * Nothing is thrown to the page.
 */
function EmergencyRead({
  show,
  copy,
  showing,
  onRead,
}: {
  show: () => Promise<MedicalAlertResult>;
  copy: MedicalAlertEmergencyCopy;
  showing: string;
  onRead: (text: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<"not_yet" | "closed" | "no_signal" | null>(null);
  const [pending, setPending] = useState(false);
  // Each confirm's number: a late answer to an earlier one, cancelled or timed
  // out, finds a newer number here and is dropped.
  const attempt = useRef(0);
  const settle = (mine: number, outcome: () => void) => {
    if (attempt.current !== mine) return;
    attempt.current += 1;
    setPending(false);
    outcome();
  };
  const confirm = () => {
    setProblem(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setProblem("no_signal");
      return;
    }
    attempt.current += 1;
    const mine = attempt.current;
    setPending(true);
    const timer = setTimeout(
      () => settle(mine, () => setProblem("no_signal")),
      EMERGENCY_READ_TIMEOUT_MS,
    );
    show().then(
      (result) => {
        clearTimeout(timer);
        settle(mine, () => {
          if (result.ok) onRead(result.text);
          else setProblem(result.reason === "not_yet" ? "not_yet" : "closed");
        });
      },
      () => {
        // A server-action fetch that never reached the server.
        clearTimeout(timer);
        settle(mine, () => setProblem("no_signal"));
      },
    );
  };
  const cancel = () => {
    attempt.current += 1;
    setPending(false);
    setConfirming(false);
    setProblem(null);
  };
  const problemText =
    problem === "no_signal"
      ? copy.noSignal
      : problem === "not_yet"
        ? copy.notYet
        : problem === "closed"
          ? copy.closed
          : null;
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
            {/* Enabled while it waits: on one bar the staffer must be able to back out. */}
            <button
              type="button"
              onClick={cancel}
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
      {problemText ? (
        <p role="alert" className="text-xs font-medium text-danger">
          {problemText}
        </p>
      ) : null}
    </div>
  );
}
