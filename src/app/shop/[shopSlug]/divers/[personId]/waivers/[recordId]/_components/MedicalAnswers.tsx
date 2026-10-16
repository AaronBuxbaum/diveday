"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { AnsweredMedicalQuestion } from "@/lib/medical";
import type { ShowMedicalAnswersResult } from "../actions";

export type MedicalAnswersCopy = {
  yes: string;
  no: string;
  show: string;
  showing: string;
  /** Says the tap is recorded before anyone makes it. */
  showHint: string;
  failed: string;
};

/**
 * **The questionnaire on a signed release, read on purpose** (issue #2157).
 *
 * At rest this is what every staff role already reads: the prompts that
 * flagged. An owner or manager gets "Show answers", whose action writes who
 * read them to the diver's trail and only then sends back every answer
 * (`showMedicalAnswersAction`). Nothing behind the tap
 * is in the page's own render, so hiding it here is not the gate; the action
 * is.
 */
export function MedicalAnswers({
  flagged,
  show,
  emptyText,
  copy,
}: {
  /** The prompts that flagged, shown without a tap. */
  flagged: readonly AnsweredMedicalQuestion[];
  /** The bound action, for a reader allowed every answer on a release that has them. */
  show?: () => Promise<ShowMedicalAnswersResult>;
  /** Said when nothing is listed and nothing can be shown. */
  emptyText: string | null;
  copy: MedicalAnswersCopy;
}) {
  const [result, reveal] = useActionState<ShowMedicalAnswersResult | null>(
    async () => (show ? show() : { ok: false }),
    null,
  );
  const shown = result?.ok ? result : null;
  const rows = shown ? shown.answers : flagged;
  return (
    <div className="grid gap-4">
      {rows.length > 0 ? (
        <ol className="grid gap-2 text-sm">
          {rows.map((question) => (
            <li
              key={question.id}
              className={`flex items-baseline justify-between gap-4 ${
                question.yes ? "font-medium text-warning-strong" : ""
              }`}
            >
              <span className="min-w-0">{question.prompt}</span>
              <span className="shrink-0 tabular-nums">{question.yes ? copy.yes : copy.no}</span>
            </li>
          ))}
        </ol>
      ) : !show && emptyText ? (
        <p className="text-sm text-muted">{emptyText}</p>
      ) : null}
      {show && !shown ? (
        <form action={reveal} className="flex flex-col items-start gap-1 print:hidden">
          <SubmitButton
            pendingLabel={copy.showing}
            className={buttonClass({ variant: "secondary", size: "sm", busy: true })}
          >
            {copy.show}
          </SubmitButton>
          <p className="text-xs text-muted">{copy.showHint}</p>
          {result && !result.ok ? (
            <p role="alert" className="text-xs font-medium text-danger">
              {copy.failed}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
