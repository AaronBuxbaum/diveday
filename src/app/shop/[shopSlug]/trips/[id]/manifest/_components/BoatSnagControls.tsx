"use client";

import { useActionState, useId } from "react";
import { buttonClass } from "@/components/ui/button";
import { SummaryCaret } from "@/components/ui/disclosure";
import { controlClass, textareaClassFor } from "@/components/ui/form";
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
  /** "Which item?", the picker over the list's lines. */
  noteItemLabel: string;
  /** "Pick an item", the picker's empty first choice: nothing is preselected. */
  noteItemPlaceholder: string;
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
 * **Note a problem**, once for the whole list (visual review 2026-10-24, B07):
 * a fold with an item picker ("Which item?"), one box ("What's wrong?") and a
 * save. One action at the foot rather than one under every line, so the list
 * reads as a list. Closed at rest; a saved note appears under the line it
 * names, and the box empties for the next one. A note informs the next crew
 * and holds nothing (H-51).
 */
export function SnagNoteForm({
  items,
  action,
  copy,
}: {
  /** The list's lines, in their order: the note is written against one. */
  items: readonly { id: string; label: string }[];
  action: SnagAction;
  copy: SnagCopy;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const fieldId = useId();
  const itemFieldId = `${fieldId}-item`;
  const errorId = `${fieldId}-error`;
  const refused = result !== null && !result.ok;
  return (
    <details className="group/snag px-4 py-3 print:hidden">
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
        <label htmlFor={itemFieldId} className="text-sm font-medium">
          {copy.noteItemLabel}
        </label>
        <select
          id={itemFieldId}
          name="checklistItemId"
          required
          // **No line is picked for the crew** (layer 4 review, dde-a F3): a
          // note saved without touching the picker would land on whichever
          // line came first and misinform the next crew. The empty choice is
          // refused by `required`, and the server refuses an empty id too.
          defaultValue=""
          className={controlClass}
        >
          <option value="" disabled>
            {copy.noteItemPlaceholder}
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
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
          rows={2}
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
