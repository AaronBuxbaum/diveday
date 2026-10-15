"use client";

import { useActionState, useId } from "react";
import { buttonClass } from "@/components/ui/button";
import { SummaryCaret } from "@/components/ui/disclosure";
import { textareaClassFor } from "@/components/ui/form";
import { SNAG_NOTE_MAX } from "@/lib/pre-departure-check";
import type { SnagResult } from "../actions";

export type SnagAction = (prev: SnagResult, formData: FormData) => Promise<SnagResult>;

/** One snag as the checklist draws it, every sentence composed server-side. */
export type SnagViewItem = {
  id: string;
  /** "Radio check: VHF crackles on 16", for a snag carried from another departure. */
  line: string;
  /** The note alone, under the line this crew wrote it against. */
  note: string;
  /** "Noted by Sal Moretti, Thu, Oct 15, 5:16 AM EDT". */
  notedBy: string;
  /** "Ana Ruiz found it still there, …", when a later crew looked. */
  stillThere?: string;
  /** The whole printed line, for the sheet the boat carries. */
  printLine: string;
};

export type SnagCopy = {
  snagsHeading: string;
  snagFixed: string;
  snagStillThere: string;
  snagSaving: string;
  noteProblem: string;
  noteLabel: string;
  noteSave: string;
  noteRefused: string;
  errorRefusal: string;
};

/**
 * **Fixed** and, for a snag another crew handed on, **Still there**: one form,
 * the answer is the button pressed. A refusal says "try again" beside it.
 */
export function SnagAnswer({
  snagId,
  action,
  copy,
  offerStillThere,
}: {
  snagId: string;
  action: SnagAction;
  copy: SnagCopy;
  offerStillThere: boolean;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
      <input type="hidden" name="snagId" value={snagId} />
      <button
        type="submit"
        name="answer"
        value="fixed"
        disabled={isPending}
        aria-busy={isPending}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {isPending ? copy.snagSaving : copy.snagFixed}
      </button>
      {offerStillThere ? (
        <button
          type="submit"
          name="answer"
          value="still_there"
          disabled={isPending}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {copy.snagStillThere}
        </button>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="basis-full text-sm font-medium text-danger">
          {copy.errorRefusal}
        </p>
      ) : null}
    </form>
  );
}

/**
 * **Note a problem**, under one checklist line: a fold with one box ("What's
 * wrong?") and a save. Closed at rest, so five lines stay five lines; a saved
 * note appears above it, and the box empties for the next one.
 */
export function SnagNoteForm({
  checklistItemId,
  action,
  copy,
}: {
  checklistItemId: string;
  action: SnagAction;
  copy: SnagCopy;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const refused = result !== null && !result.ok;
  return (
    <details className="group/snag mt-1 print:hidden">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        <SummaryCaret className="group-open/snag:rotate-90" />
        {copy.noteProblem}
      </summary>
      {/* `key` empties the box once a note is saved: the form remounts. */}
      <form
        key={result?.ok ? "saved" : "draft"}
        action={formAction}
        className="mt-1 flex flex-col gap-2"
      >
        <input type="hidden" name="checklistItemId" value={checklistItemId} />
        <label htmlFor={fieldId} className="text-sm font-medium">
          {copy.noteLabel}
        </label>
        <textarea
          id={fieldId}
          name="note"
          required
          maxLength={SNAG_NOTE_MAX}
          aria-invalid={refused && result?.reason === "note_invalid" ? true : undefined}
          aria-describedby={refused ? errorId : undefined}
          className={textareaClassFor(2)}
        />
        {refused ? (
          <p id={errorId} role="alert" className="text-sm font-medium text-danger">
            {result.reason === "note_invalid" ? copy.noteRefused : copy.errorRefusal}
          </p>
        ) : null}
        <div>
          <button
            type="submit"
            disabled={isPending}
            aria-busy={isPending}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {isPending ? copy.snagSaving : copy.noteSave}
          </button>
        </div>
      </form>
    </details>
  );
}
