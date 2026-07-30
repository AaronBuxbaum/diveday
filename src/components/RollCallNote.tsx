"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { controlClass } from "@/components/ui/form";
import { clearNoteDraft, readNoteDraft, writeNoteDraft } from "@/lib/roll-call-note-draft";

type SaveNote = (
  bookingId: string,
  checkpoint: string,
  note: string,
) => Promise<{ ok: boolean; saved: boolean }>;

type Status = "idle" | "saving" | "saved" | "queued" | "error";

export type RollCallNoteCopy = {
  optionalNote: string;
  message: {
    manualOnly: string;
    saving: string;
    saved: string;
    queued: string;
    error: string;
    idle: string;
  };
  statusPill: {
    saving: string;
    saved: string;
    queued: string;
    error: string;
  };
  notePlaceholder: string;
};

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * The roll-call note field. When the diver already has a result recorded at this
 * checkpoint the note saves itself as staff type (debounced, plus on blur) so a
 * kit issue or medical question is never lost to a forgotten button. Before any
 * result exists the note instead rides the not-boarded form via `form`, so a
 * note drafted while marking someone ashore is still captured on submit.
 *
 * Every keystroke is also mirrored to this device (localStorage) the instant it
 * changes, so a note is never lost to a dropped connection: if the server save
 * fails offline the draft is held as pending and replayed automatically the
 * moment the browser fires `online`, or on the next load of this manifest.
 */
export function RollCallNote({
  bookingId,
  checkpoint,
  formId,
  initialNote,
  canAutoSave,
  saveNote,
  copy,
}: {
  bookingId: string;
  checkpoint: string;
  formId: string;
  initialNote: string;
  canAutoSave: boolean;
  saveNote: SaveNote;
  copy: RollCallNoteCopy;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  const commit = useCallback(
    (value: string) => {
      // Hold the draft as pending until the server acknowledges it, so a reload
      // or a reconnect mid-flight still knows the value hasn't landed yet.
      writeNoteDraft(bookingId, checkpoint, { value, pending: true });
      setStatus("saving");
      startTransition(async () => {
        try {
          const result = await saveNote(bookingId, checkpoint, value);
          if (result.ok && result.saved) {
            clearNoteDraft(bookingId, checkpoint);
            setStatus("saved");
          } else {
            // Server reached but there is no recorded result to attach the note
            // to (a race with a clear/undo). Retrying can't help, so stop
            // replaying it — but keep the text on the device so a reload
            // restores it onto the not-boarded form path.
            writeNoteDraft(bookingId, checkpoint, { value, pending: false });
            setStatus("error");
          }
        } catch {
          // A throw is a dropped connection or a server error, not a rejection:
          // the pending draft stays on the device either way. Offline, the
          // `online` listener replays it automatically; online, only a reload
          // or a manual re-blur retries — so don't promise an automatic resync.
          setStatus(isOnline() ? "error" : "queued");
        }
      });
    },
    [bookingId, checkpoint, saveNote],
  );

  useEffect(() => {
    // On load, replay anything this device saved but never got confirmed —
    // e.g. the tab was closed offline before the note could sync.
    const draft = readNoteDraft(bookingId, checkpoint);
    if (draft) {
      if (draft.value === initialNote) {
        // Already reflected in the server value we rendered; nothing pending.
        clearNoteDraft(bookingId, checkpoint);
      } else {
        // A draft that diverges from the server value is restored regardless of
        // whether it can resync yet, so the note is never silently dropped.
        if (inputRef.current) inputRef.current.value = draft.value;
        if (canAutoSave && draft.pending) {
          setStatus("queued");
          if (isOnline()) commit(draft.value);
        }
      }
    }

    // Replay a pending draft the moment the connection returns.
    function onOnline() {
      const pending = readNoteDraft(bookingId, checkpoint);
      if (canAutoSave && pending?.pending) commit(pending.value);
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [bookingId, checkpoint, initialNote, canAutoSave, commit]);

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { value } = event.target;
    // Persist every keystroke to this device first — the never-lost guarantee.
    writeNoteDraft(bookingId, checkpoint, { value, pending: true });
    if (!canAutoSave) return;
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    timer.current = setTimeout(() => commit(value), 700);
  }

  const message = !canAutoSave
    ? copy.message.manualOnly
    : status === "saving"
      ? copy.message.saving
      : status === "saved"
        ? copy.message.saved
        : status === "queued"
          ? copy.message.queued
          : status === "error"
            ? copy.message.error
            : copy.message.idle;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between">
        <label htmlFor={`roll-call-note-${bookingId}`} className="text-sm font-semibold">
          {copy.optionalNote}
        </label>
        {canAutoSave && (
          <div className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            <span
              className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
                status === "saving"
                  ? "bg-warning animate-pulse"
                  : status === "saved"
                    ? "bg-success"
                    : status === "queued"
                      ? "bg-info animate-pulse"
                      : status === "error"
                        ? "bg-danger"
                        : "bg-border-strong"
              }`}
              aria-hidden="true"
            />
            <span>
              {status === "saving"
                ? copy.statusPill.saving
                : status === "saved"
                  ? copy.statusPill.saved
                  : status === "queued"
                    ? copy.statusPill.queued
                    : status === "error"
                      ? copy.statusPill.error
                      : ""}
            </span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        id={`roll-call-note-${bookingId}`}
        name="note"
        form={canAutoSave ? undefined : formId}
        defaultValue={initialNote}
        maxLength={300}
        placeholder={copy.notePlaceholder}
        className={`${controlClass} mt-1`}
        onChange={onChange}
        onBlur={
          canAutoSave
            ? (event) => {
                if (timer.current) clearTimeout(timer.current);
                commit(event.target.value);
              }
            : undefined
        }
      />
      <p className="mt-1 text-xs text-muted" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
