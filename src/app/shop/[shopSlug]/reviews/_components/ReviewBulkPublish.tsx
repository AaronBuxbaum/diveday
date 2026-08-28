// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { createContext, useActionState, useContext } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FormStatus } from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import { type BulkPublishResult, publishReviewsAction } from "../actions";

/**
 * **Clear the whole worklist in one act** (ADR 20260827-people-not-lists,
 * decision 3).
 *
 * It used to be a tick box on every waiting row plus a "Publish selected"
 * button, which asked a staffer to make a selection before making a decision —
 * two acts for the case that is nearly always "all of them", and a column of
 * empty boxes down a queue the rest of the time. Now the group header carries
 * the act and the group *is* the selection: "Publish both", "Publish all 5".
 * The rows still each carry their own Publish, so releasing some-but-not-all
 * costs exactly the taps it is worth.
 *
 * The provider owns the **action state** rather than any selection, and that is
 * the whole reason it is still a provider: the button lives in the waiting
 * group's header and the sentence reporting what it did has to outlive it.
 * Publishing everything empties the group, which takes the header — and the
 * button — off the page; a `useActionState` living inside the button would
 * take the confirmation of the pass that just cleared the queue down with it.
 * Hoisted here, `PublishAllStatus` renders unconditionally above the groups.
 *
 * Staff client components take their words as props — they cannot translate
 * (ADR 20260730-staff-copy-localization).
 */
const PublishAllContext = createContext<{
  result: BulkPublishResult;
  publish: (formData: FormData) => void;
} | null>(null);

export function PublishAllProvider({ children }: { children: React.ReactNode }) {
  const [result, publish] = useActionState(publishReviewsAction, null);
  return (
    <PublishAllContext.Provider value={{ result, publish }}>{children}</PublishAllContext.Provider>
  );
}

function usePublishAll() {
  const context = useContext(PublishAllContext);
  if (!context) throw new Error("Review publish-all control used outside its provider");
  return context;
}

/**
 * The group header's act. Posts the ids of exactly the rows rendered beneath
 * it, so what the label promises and what the pass touches are the same set —
 * there is no invisible selection to get out of step with the screen.
 */
export function PublishAllButton({
  reviewIds,
  label,
  pendingLabel,
  className,
}: {
  /** Every waiting row on screen, in the order they render. */
  reviewIds: readonly string[];
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { publish } = usePublishAll();
  return (
    <form action={publish}>
      {reviewIds.map((reviewId) => (
        <input key={reviewId} type="hidden" name="reviewIds" value={reviewId} />
      ))}
      <SubmitButton pendingLabel={pendingLabel} className={className}>
        {label}
      </SubmitButton>
    </form>
  );
}

/** The words this control reports with, translated on the server ahead of it. */
export type BulkPublishCopy = {
  /** `{count}` templates, fetched with `t.raw` — the count is only known client-side. */
  publishedManyOne: string;
  publishedManyOther: string;
  error: string;
};

/**
 * What the last pass did.
 *
 * **Rendered unconditionally**, which is the whole point: a publish-all has no
 * single control to sit beside — what moved is N rows across the list — and the
 * case that most needs a sentence is the one that clears the queue and takes
 * the button away with it.
 */
export function PublishAllStatus({
  copy,
  className = "",
}: {
  copy: BulkPublishCopy;
  className?: string;
}) {
  const { result } = usePublishAll();
  if (!result) return <FormStatus className={className} />;
  if (result.ok) {
    return (
      <FormStatus tone="success" className={className}>
        {fill(
          pluralForm(result.published, {
            one: copy.publishedManyOne,
            other: copy.publishedManyOther,
          }),
          { count: result.published },
        )}
      </FormStatus>
    );
  }
  return (
    <FormStatus tone="danger" className={className}>
      {copy.error}
    </FormStatus>
  );
}
