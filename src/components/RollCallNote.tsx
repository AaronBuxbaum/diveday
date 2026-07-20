"use client";

import { useRef, useState, useTransition } from "react";
import { controlClass } from "@/components/ui/form";

type SaveNote = (
  bookingId: string,
  checkpoint: string,
  note: string,
) => Promise<{ ok: boolean; saved: boolean }>;

/**
 * The roll-call note field. When the diver already has a result recorded at this
 * checkpoint the note saves itself as staff type (debounced, plus on blur) so a
 * kit issue or medical question is never lost to a forgotten button. Before any
 * result exists the note instead rides the not-boarded form via `form`, so a
 * note drafted while marking someone ashore is still captured on submit.
 */
export function RollCallNote({
  bookingId,
  checkpoint,
  formId,
  initialNote,
  canAutoSave,
  saveNote,
}: {
  bookingId: string;
  checkpoint: string;
  formId: string;
  initialNote: string;
  canAutoSave: boolean;
  saveNote: SaveNote;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();

  function commit(value: string) {
    setStatus("saving");
    startTransition(async () => {
      try {
        const result = await saveNote(bookingId, checkpoint, value);
        setStatus(result.ok && result.saved ? "saved" : "error");
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <div className="mt-2">
      <label htmlFor={`roll-call-note-${bookingId}`} className="text-sm font-semibold">
        Optional note
      </label>
      <textarea
        id={`roll-call-note-${bookingId}`}
        name="note"
        form={canAutoSave ? undefined : formId}
        defaultValue={initialNote}
        maxLength={300}
        rows={3}
        placeholder="Late to the boat, medical question, kit issue…"
        className={`${controlClass} mt-1`}
        onChange={
          canAutoSave
            ? (event) => {
                const { value } = event.target;
                if (timer.current) clearTimeout(timer.current);
                setStatus("saving");
                timer.current = setTimeout(() => commit(value), 700);
              }
            : undefined
        }
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
        {!canAutoSave
          ? "Saved with the staff audit trail when you record a status."
          : status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved to the staff audit trail."
              : status === "error"
                ? "Couldn’t save — check your connection and try again."
                : "Saves automatically as you type."}
      </p>
    </div>
  );
}
