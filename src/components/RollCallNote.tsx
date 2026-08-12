"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { controlClass } from "@/components/ui/form";
import { clearNoteDraft, readNoteDraft, writeNoteDraft } from "@/lib/roll-call-note-draft";

type SaveNote = (
  bookingId: string,
  checkpoint: string,
  note: string,
) => Promise<{ ok: boolean; saved: boolean }>;

type Status = "idle" | "saving" | "saved" | "waiting" | "queued" | "error";

export type RollCallNoteCopy = {
  /**
   * The field's accessible name. Rendered `sr-only` — the disclosure this
   * field lives behind is already labelled "Add a note", so on screen the
   * label was that word again one line below itself.
   */
  optionalNote: string;
  /**
   * What the save state says, in one line under the field. There used to be a
   * second, shorter set of the same words in a pill above it — "Saving…" beside
   * "Saving…", "Saved" beside "Saved to this roll-call record." — so the pill's
   * dot is all that survives of it, as this line's own status mark.
   */
  message: {
    saving: string;
    saved: string;
    /** No result on this row yet, so the note is waiting for one to attach to. */
    waiting: string;
    queued: string;
    error: string;
    idle: string;
  };
  notePlaceholder: string;
};

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * The roll-call note field. It saves itself as staff type (debounced, plus on
 * blur), like every other field on a diver's row — a kit issue or a medical
 * question is never one forgotten button away from being lost.
 *
 * It used to save itself *only* once the diver already had a result recorded at
 * this checkpoint, and otherwise explained itself in a line of copy ("Saves with
 * this diver's roll-call result.") while riding the not-boarded form via a
 * `form=` attribute. Two problems with that: it made one field behave two ways
 * for a reason a staffer at the rail cannot see, and a note typed before the
 * diver was marked **boarded** was silently dropped, because only the *other*
 * button carried it.
 *
 * The underlying constraint is real and unchanged — a note lives on the
 * roll-call event row (`updateLatestRollCallNote`), and before anyone is called
 * there is no row to hold it. So the field now always tries the save, and when
 * the server has nowhere to put it the draft simply stays pending on the device
 * and is posted by whichever roll-call button is pressed next (see
 * `useUnsavedNote` in RollCallButton). Either way the note lands, and the field
 * never has to explain a rule.
 *
 * Every keystroke is also mirrored to this device (localStorage) the instant it
 * changes, so a note is never lost to a dropped connection: if the server save
 * fails offline the draft is held as pending and replayed automatically the
 * moment the browser fires `online`, or on the next load of this manifest.
 */
export function RollCallNote({
  bookingId,
  checkpoint,
  initialNote,
  saveNote,
  copy,
}: {
  bookingId: string;
  checkpoint: string;
  initialNote: string;
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
          if (!result.ok) {
            // The action itself refused — a value that failed its schema, or a
            // checkpoint it could not prove. That is a fault, not a hold, and
            // the draft stays pending so a reload or a re-blur retries it.
            setStatus("error");
          } else if (result.saved) {
            // Clear only what *this* save actually landed. Staff type faster
            // than a round trip: while this request was in flight the field
            // may have moved on, and its newer text is sitting in the draft
            // with its own debounce behind it. Clearing that would open a
            // window — up to one debounce wide — in which the newer note is on
            // neither the server nor the device, so a "Mark boarded" tap
            // during it would post nothing and lose the note outright, which
            // is the exact failure this whole path exists to prevent.
            const current = readNoteDraft(bookingId, checkpoint);
            if (current && current.value !== value) return;
            clearNoteDraft(bookingId, checkpoint);
            setStatus("saved");
          } else {
            // Reached and accepted, but there is no recorded roll-call result
            // on this row for the note to attach to. That is the *ordinary*
            // state of an uncalled diver, not an error — so the draft stays
            // pending on the device, where the next roll-call submit picks it
            // up, and the line says it is held rather than that it failed.
            setStatus("waiting");
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
        if (draft.pending) {
          setStatus("queued");
          if (isOnline()) commit(draft.value);
        }
      }
    }

    // Replay a pending draft the moment the connection returns.
    function onOnline() {
      const pending = readNoteDraft(bookingId, checkpoint);
      if (pending?.pending) commit(pending.value);
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [bookingId, checkpoint, initialNote, commit]);

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const { value } = event.target;
    // Persist every keystroke to this device first — the never-lost guarantee.
    writeNoteDraft(bookingId, checkpoint, { value, pending: true });
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    timer.current = setTimeout(() => commit(value), 700);
  }

  const message =
    status === "saving"
      ? copy.message.saving
      : status === "saved"
        ? copy.message.saved
        : status === "waiting"
          ? copy.message.waiting
          : status === "queued"
            ? copy.message.queued
            : status === "error"
              ? copy.message.error
              : copy.message.idle;

  return (
    <div>
      <label htmlFor={`roll-call-note-${bookingId}`} className="sr-only">
        {copy.optionalNote}
      </label>
      <input
        ref={inputRef}
        id={`roll-call-note-${bookingId}`}
        name="note"
        defaultValue={initialNote}
        maxLength={300}
        placeholder={copy.notePlaceholder}
        className={controlClass}
        onChange={onChange}
        onBlur={(event) => {
          if (timer.current) clearTimeout(timer.current);
          commit(event.target.value);
        }}
      />
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        {/* The dot the status pill used to carry, now this line's own mark —
            colour is never the message here, only a faster read of the words
            beside it. */}
        <span
          className={`size-2 shrink-0 rounded-full transition-colors duration-300 ${
            status === "saving"
              ? "animate-pulse bg-warning"
              : status === "saved"
                ? "bg-success"
                : status === "queued"
                  ? "animate-pulse bg-info"
                  : status === "error"
                    ? "bg-danger"
                    : "bg-border-strong"
          }`}
          aria-hidden="true"
        />
        {message}
      </p>
    </div>
  );
}
