"use client";

import { useActionState, useId, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { textareaClassFor } from "@/components/ui/form";
import { MAX_REVIEW_REPLY_LENGTH } from "@/lib/reviews";
import { type ReviewReplyResult, reviewReplyAction } from "../actions";

/** Every word the reply block shows, translated by the page. */
export type ReviewReplyCopy = {
  /** The disclosure that opens an empty reply: "Reply in public". */
  reply: string;
  /** The label over the shop's reply as it stands: "Your reply". */
  yourReply: string;
  /** The textarea's label. */
  fieldLabel: string;
  /** Under the box: who will read it. */
  hint: string;
  save: string;
  saving: string;
  edit: string;
  cancel: string;
  delete: string;
  deleteConfirm: string;
  replied: string;
  edited: string;
  deleted: string;
  notAuthorized: string;
  empty: string;
  tooLong: string;
  notAnswerable: string;
  error: string;
};

/**
 * **The shop's public reply under one published review** (batch 4, K2).
 *
 * Shows the reply as it stands, or a quiet "Reply in public" for a review that
 * has none, and opens to one textarea. Only offered where a reply can render:
 * a published review with words. `canReply` is the owner/manager gate as the
 * page read it; the action checks it again, because hiding a form is not a gate.
 *
 * Settles in place, like the row's other acts, and says what happened beside
 * itself in a polite live region.
 */
export function ReviewReply({
  reviewId,
  reply,
  canReply,
  copy,
}: {
  reviewId: string;
  reply: string | null;
  canReply: boolean;
  copy: ReviewReplyCopy;
}) {
  const [state, action] = useActionState<ReviewReplyResult, FormData>(reviewReplyAction, null);
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);
  const fieldId = useId();
  // Settled: a successful save or delete closes the editor.
  const [seen, setSeen] = useState<ReviewReplyResult>(null);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) {
      setEditing(false);
      setArmed(false);
    }
  }

  if (!reply && !canReply) return null;

  const status = state ? statusWords(state, copy) : null;
  return (
    <div className="mt-2" data-review-reply-staff="">
      {reply && !editing ? (
        <div className="border-s-2 border-border ps-3">
          <p className="text-xs font-medium text-muted">{copy.yourReply}</p>
          <p className="mt-0.5 break-words text-sm text-pretty">{reply}</p>
          {canReply ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 print:hidden">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {copy.edit}
              </button>
              <form action={action}>
                <input type="hidden" name="reviewId" value={reviewId} />
                <input type="hidden" name="intent" value="delete" />
                {armed ? (
                  <SubmitButton
                    pendingLabel={copy.saving}
                    className={buttonClass({ variant: "danger", size: "sm" })}
                  >
                    {copy.deleteConfirm}
                  </SubmitButton>
                ) : (
                  <button
                    type="button"
                    onClick={() => setArmed(true)}
                    className={buttonClass({ variant: "link", size: "sm", flush: true })}
                  >
                    {copy.delete}
                  </button>
                )}
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
      {!reply && !editing && canReply ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={buttonClass({
            variant: "link",
            size: "sm",
            flush: true,
            className: "print:hidden",
          })}
        >
          {copy.reply}
        </button>
      ) : null}
      {editing && canReply ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="intent" value="save" />
          <label htmlFor={fieldId} className="text-xs font-medium text-muted">
            {copy.fieldLabel}
          </label>
          <textarea
            rows={3}
            id={fieldId}
            name="body"
            required
            maxLength={MAX_REVIEW_REPLY_LENGTH}
            defaultValue={reply ?? ""}
            aria-describedby={`${fieldId}-hint`}
            className={textareaClassFor(3)}
          />
          <p id={`${fieldId}-hint`} className="text-xs text-muted">
            {copy.hint}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton
              pendingLabel={copy.saving}
              className={buttonClass({ variant: "secondary" })}
            >
              {copy.save}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={buttonClass({ variant: "ghost" })}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={`text-xs ${state && !state.ok ? "text-danger" : "text-muted"} ${status ? "mt-1" : ""}`}
      >
        {status}
      </p>
    </div>
  );
}

function statusWords(state: NonNullable<ReviewReplyResult>, copy: ReviewReplyCopy): string {
  if (state.ok) {
    return state.effect === "replied"
      ? copy.replied
      : state.effect === "edited"
        ? copy.edited
        : copy.deleted;
  }
  switch (state.reason) {
    case "not-authorized":
      return copy.notAuthorized;
    case "empty":
      return copy.empty;
    case "too-long":
      return copy.tooLong;
    case "not-answerable":
      return copy.notAnswerable;
    default:
      return copy.error;
  }
}
