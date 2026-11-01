// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { useActionState, useState, useTransition } from "react";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { requestElearningPage, useCertCheckExtension } from "@/components/useCertCheckExtension";
import type { ElearningQuery } from "@/lib/elearning-check";
import type { ElearningCheckResult } from "../elearning-actions";

/** Every word this control renders, translated on the server. */
export type ElearningCheckCopy = {
  check: string;
  checking: string;
  complete: string;
  notComplete: string;
  noRecord: string;
  unreadable: string;
  /** "Sign in to the PADI Pros’ Site first": the extension met PADI's sign-in. */
  signedOut: string;
  failed: string;
  /** Someone ticked the materials first (or re-ticked since): the check or its Undo changed nothing. */
  alreadyDone: string;
  undo: string;
  undoPending: string;
  dismiss: string;
};

/**
 * **"Check eLearning with PADI", beside a course student's materials tick**
 * (H-106).
 *
 * Drawn only when the DiveDay browser extension is in this browser: without it
 * there is nothing to press, and the materials tick beside it is the whole
 * story, as it was. The extension looks the student up on the PADI Pros' Site
 * in the background, in the staffer's own signed-in browser, and hands back
 * the page's text; `elearningCheckAction` decides on the server whether it
 * shows this course finished and ticks the materials if it does. Every other
 * answer writes nothing and says what PADI's page showed.
 *
 * It stays mounted once the tick lands, drawing only the toast, because the
 * toast's Undo has to outlive the re-render that settles the row.
 */
export function ElearningCheck({
  query,
  bookingId,
  materialsDone,
  action,
  copy,
  offNote,
}: {
  /** What the extension searches for, or null when this seat cannot be checked. */
  query: ElearningQuery | null;
  bookingId: string;
  materialsDone: boolean;
  /** `elearningCheckAction` bound to this shop and departure, on the server. */
  action: (previous: ElearningCheckResult, formData: FormData) => Promise<ElearningCheckResult>;
  copy: ElearningCheckCopy;
  /**
   * "PADI checks are off for this shop…": said beside the tick when the
   * extension is here but the shop's switch keeps PADI's eLearning check off
   * (H-121).
   */
  offNote?: string | null;
}) {
  const hasExtension = useCertCheckExtension();
  const [result, formAction, judging] = useActionState(action, null);
  const [asking, setAsking] = useState(false);
  const [extensionFailed, setExtensionFailed] = useState<"signed_out" | "other" | null>(null);
  const [, startTransition] = useTransition();
  if (!hasExtension) return null;
  if (!query) {
    return offNote && !materialsDone ? (
      <span className="mt-2 block text-sm text-muted print:hidden">{offNote}</span>
    ) : null;
  }
  const busy = asking || judging;

  async function check() {
    if (!query) return;
    setAsking(true);
    setExtensionFailed(null);
    const reply = await requestElearningPage(query);
    setAsking(false);
    if (!reply.ok) {
      setExtensionFailed(reply.reason === "signed_out" ? "signed_out" : "other");
      return;
    }
    const formData = new FormData();
    formData.set("bookingId", bookingId);
    formData.set("pageText", reply.pageText);
    startTransition(() => formAction(formData));
  }

  const undo = result?.ok && result.verdict === "complete" ? result.undo : undefined;
  const outcome = extensionFailed
    ? extensionFailed === "signed_out"
      ? copy.signedOut
      : copy.unreadable
    : !result
      ? null
      : !result.ok
        ? copy.failed
        : result.verdict === "not_complete"
          ? copy.notComplete
          : result.verdict === "no_record"
            ? copy.noRecord
            : result.verdict === "unreadable"
              ? copy.unreadable
              : result.verdict === "already_done"
                ? copy.alreadyDone
                : null;

  return (
    <>
      {materialsDone && outcome ? (
        // The materials read as done, so the button is gone; a no-op Undo still says why.
        <span className="mt-2 block print:hidden">
          <FormStatus tone="warning">{outcome}</FormStatus>
        </span>
      ) : null}
      {materialsDone ? null : (
        <div className="mt-2">
          <button
            type="button"
            onClick={check}
            disabled={busy}
            aria-busy={busy}
            className={buttonClass({
              variant: "link",
              size: "sm",
              flush: true,
              className: "disabled:cursor-progress disabled:opacity-70",
            })}
          >
            {busy ? copy.checking : copy.check}
          </button>
          {outcome ? (
            <span className="mt-1 block">
              <FormStatus tone={result && !result.ok ? "danger" : "warning"}>{outcome}</FormStatus>
              {result?.ok && result.verdict === "not_complete" ? (
                <span className="mt-1 block text-sm italic">{result.evidence}</span>
              ) : null}
            </span>
          ) : null}
        </div>
      )}
      {undo ? (
        <UndoToast
          message={copy.complete}
          action={formAction}
          fields={{ bookingId: undo.bookingId, markedAt: undo.markedAt, intent: "undo" }}
          pendingLabel={copy.undoPending}
          undoLabel={copy.undo}
          dismissLabel={copy.dismiss}
        />
      ) : null}
    </>
  );
}
