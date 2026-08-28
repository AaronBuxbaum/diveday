// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { createContext, useActionState, useContext } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { NoticeTone } from "@/lib/staff-notices";
import { type ReviewActionResult, reviewRowAction } from "../actions";
import { ReviewHideForm } from "./ReviewHideForm";

/**
 * Every word this control renders, translated on the server ahead of it —
 * staff client components take their words as props and never translate
 * (ADR 20260730-staff-copy-localization).
 */
export type ReviewRowCopy = {
  publish: string;
  /** The same act on a review the shop took down — "Republish", not "Publish". */
  republish: string;
  saving: string;
  hide: string;
  hideConfirm: string;
  hideReasonLabel: string;
  hideReasonPlaceholder: string;
  hideNoteLabel: string;
  markStandout: string;
  removeStandout: string;
  hiddenToast: string;
  undo: string;
  undoPending: string;
  /** The outcome sentences, by the code the action answers with. */
  published: string;
  standout: string;
  standoutRemoved: string;
  reasonRequired: string;
  noteRequired: string;
  noteTooLong: string;
  error: string;
};

/**
 * What the tap did, as a sentence and a tone — or nothing.
 *
 * A successful **hide** deliberately returns nothing: the land-then-undo toast
 * is that outcome's confirmation, and a second sentence in the row beside it
 * would be the same news twice, one of them without the Undo that is the whole
 * point of announcing it.
 */
function statusOf(
  result: ReviewActionResult,
  reviewId: string,
  copy: ReviewRowCopy,
): { tone: NoticeTone; text: string } | undefined {
  // One state serves the whole list, so a row reports only its own outcome.
  if (!result || result.reviewId !== reviewId) return undefined;
  if (result.ok) {
    if (result.effect === "hidden") return undefined;
    const text =
      result.effect === "published"
        ? copy.published
        : result.effect === "standout"
          ? copy.standout
          : copy.standoutRemoved;
    return { tone: "success", text };
  }
  const text =
    result.reason === "reason-required"
      ? copy.reasonRequired
      : result.reason === "note-required"
        ? copy.noteRequired
        : result.reason === "note-too-long"
          ? copy.noteTooLong
          : copy.error;
  return { tone: "danger", text };
}

/**
 * **The row action's state, held above the list rather than inside a row.**
 *
 * The same reasoning as `PublishAllProvider`, one scale up, and the reason the
 * row's own `useActionState` had to leave: this page renders three independent
 * `<ul>`s — waiting, published, hidden — and the *whole point* of every control
 * in the bar is to move a review from one of them to another. React reparents
 * nothing; it unmounts the row from the list it left and mounts a new one in
 * the list it joined. So a state living in the row was destroyed by exactly the
 * act it existed to report: publish a waiting review and the confirmation, the
 * refusal and the hide's Undo all vanished with the `<li>`, silently, on the
 * three surfaces a moderator uses most.
 *
 * Hoisted here it outlives the move. One state serves every row, so each row
 * matches `result.reviewId` against its own before saying anything — see
 * `statusOf`.
 */
const ReviewRowContext = createContext<{
  result: ReviewActionResult;
  run: (formData: FormData) => void;
} | null>(null);

export function ReviewRowProvider({ children }: { children: React.ReactNode }) {
  const [result, run] = useActionState(reviewRowAction, null);
  return <ReviewRowContext.Provider value={{ result, run }}>{children}</ReviewRowContext.Provider>;
}

function useReviewRow() {
  const context = useContext(ReviewRowContext);
  if (!context) throw new Error("Review row controls used outside their provider");
  return context;
}

/**
 * One review's action bar: publish, hide behind its reason picker, and the
 * standout toggle — all three posting the **same** action so one status region
 * can outlive any of them (see `reviewRowAction`).
 *
 * Nothing here navigates. Publishing a review used to redirect the whole page
 * to `?notice=published`, which threw a staffer working down a weekend's queue
 * back to the top of the list on every tap. Now the action revalidates and the
 * row settles where it is; the outcome renders on the bar the tap came from,
 * which is where docs/design/forms-and-controls.md puts it.
 *
 * Before hydration the forms still post natively and the writes still happen —
 * only the settle-in-place reporting needs the client.
 */
export function ReviewRowActions({
  reviewId,
  isPublished,
  isHidden,
  isStandout,
  canStandout,
  reasons,
  copy,
}: {
  reviewId: string;
  isPublished: boolean;
  isHidden: boolean;
  isStandout: boolean;
  /** A published review with words of its own — a bare rating has nothing to feature. */
  canStandout: boolean;
  reasons: readonly { value: string; label: string }[];
  copy: ReviewRowCopy;
}) {
  const { result, run: formAction } = useReviewRow();
  const status = statusOf(result, reviewId, copy);

  return (
    <>
      {/* The row's trailing slot, not a bar across the bottom of a card: the
          hairline above the row is the ledger's, and a second rule inside every
          row would be a card drawn in pieces. Right-aligned so a column of rows
          ends on one edge, and `w-64` on what the disclosure opens because a
          reason picker needs a width and the slot itself is content-sized. */}
      <div className="flex flex-wrap items-center justify-end gap-1">
        {!isHidden ? (
          /* Hiding states a case, so it cannot be a bare button (ADR
             20260813-review-moderation-has-a-floor). The picker waits behind a
             disclosure: the shop that opens this is already sure, and the
             reason list is the whole point — a shop that finds none of them
             true is telling itself something. Available before publication as
             well: hiding a waiting review records the decision and keeps it out
             of the public set. */
          <details>
            <summary
              className={`${buttonClass({
                variant: "ghost",
                size: "sm",
              })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
            >
              {copy.hide}
            </summary>
            <ReviewHideForm
              reviewId={reviewId}
              action={formAction}
              className="mt-3 w-64 max-w-[70vw]"
              reasons={reasons}
              reasonLabel={copy.hideReasonLabel}
              reasonPlaceholder={copy.hideReasonPlaceholder}
              noteLabel={copy.hideNoteLabel}
              hideLabel={copy.hideConfirm}
              savingLabel={copy.saving}
            />
          </details>
        ) : null}
        {!isPublished ? (
          <form action={formAction} className="shrink-0">
            <input type="hidden" name="reviewId" value={reviewId} />
            <input type="hidden" name="publish" value="true" />
            {/* Secondary, not primary. A ledger of held reviews is a column of
                rows each offering the same act; a stack of solid buttons down
                it makes the page shout, and the one act that carries the page's
                weight is the group header's "Publish all N". */}
            <SubmitButton
              pendingLabel={copy.saving}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {isHidden ? copy.republish : copy.publish}
            </SubmitButton>
          </form>
        ) : null}
        {canStandout ? (
          <form action={formAction} className="shrink-0">
            <input type="hidden" name="intent" value="standout" />
            <input type="hidden" name="reviewId" value={reviewId} />
            <input type="hidden" name="standout" value={isStandout ? "false" : "true"} />
            <SubmitButton
              pendingLabel={copy.saving}
              className={buttonClass({ variant: "ghost", size: "sm" })}
            >
              {isStandout ? copy.removeStandout : copy.markStandout}
            </SubmitButton>
          </form>
        ) : null}
        {/* `basis-full` drops it onto its own line of the wrapping slot, so a
            refusal never squeezes the controls it is about off the row. */}
        {status ? (
          <FormStatus tone={status.tone} className="basis-full w-64 max-w-[70vw] justify-end">
            {status.text}
          </FormStatus>
        ) : null}
      </div>
    </>
  );
}

/**
 * **The hide's land-then-undo toast, rendered once above the lists.**
 *
 * It used to live inside the row, and a hide is precisely the act that takes
 * that row off the page: the review leaves the Published group, and on a shop
 * with more moderated reviews than fit one page it leaves this *page* — so
 * there was no row left to render the toast, and the Undo that is the whole
 * point of announcing a hide could not be offered at all. Hoisting the state
 * into `ReviewRowProvider` was not enough on its own; the element had to come
 * out too.
 *
 * A toast is page furniture anyway — fixed to the bottom of the viewport, not
 * part of any row — so this is also where it belonged. Same shape and same
 * reasoning as `PublishAllStatus` directly above it.
 */
export function ReviewRowUndoToast({ copy }: { copy: ReviewRowCopy }) {
  const { result, run } = useReviewRow();
  if (!result?.ok || result.effect !== "hidden" || !result.undoReviewId) return null;
  return (
    /* Undo posts back through the same action, so putting the review back lands
       in that row's own status region rather than anywhere else. */
    <UndoToast
      message={copy.hiddenToast}
      action={run}
      fields={{ reviewId: result.undoReviewId, publish: "true" }}
      pendingLabel={copy.undoPending}
      undoLabel={copy.undo}
    />
  );
}
