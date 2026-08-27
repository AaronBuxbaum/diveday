// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import { usePathname } from "next/navigation";
import { createContext, useActionState, useContext, useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FormStatus } from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import { type BulkPublishResult, publishReviewsAction } from "../actions";
import { useRevealPublished } from "./useRevealPublished";

/**
 * "Tick a few reviews, then publish them" for the moderation queue.
 *
 * Selection lives in shared client state rather than a plain HTML
 * `<input form="…">` cross-association, following the roster's bulk waiver
 * send (`trips/[id]/_components/RosterBulkWaiverSelection.tsx`): form
 * association looks correct and is spec-legal, but ticking one row was
 * observed there to silently untick another. Controlled inputs sidestep the
 * question. Like the roster's provider this one clears itself on a real
 * navigation, since it no longer unmounts for free between pages.
 *
 * Staff client components take their words as props — they cannot translate
 * (docs ADR 20260730-staff-copy-localization).
 *
 * The provider also owns the **action state**, not just the selection. The
 * button and the sentence reporting what it did are two different places on
 * the header row, and the sentence has to outlive the button: clearing the
 * last waiting review takes "Publish selected" off the page, and a
 * `useActionState` living inside it would take the confirmation of the pass
 * that just cleared the queue down with it. Hoisting it here is what lets
 * `PublishSelectedStatus` render unconditionally.
 */
const SelectionContext = createContext<{
  selected: Set<string>;
  toggle: (reviewId: string) => void;
  result: BulkPublishResult;
  publish: (formData: FormData) => void;
} | null>(null);

export function ReviewSelectionProvider({
  children,
  showingWaitingOnly,
}: {
  children: React.ReactNode;
  /** Whether the list under this is narrowed to reviews still waiting. */
  showingWaitingOnly: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, publish] = useActionState(publishReviewsAction, null);
  const pathname = usePathname();
  // A pass that published from the waiting tab drops the filter, so the rows it
  // released are still on screen underneath the confirmation.
  useRevealPublished(Boolean(result?.ok), showingWaitingOnly);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change clears the selection, which is the point.
  useEffect(() => setSelected(new Set()), [pathname]);
  // A pass that landed clears the ticks it acted on. It used to come for free
  // from the redirect this action no longer makes — the rows lose their boxes
  // on the re-render either way, but leaving their ids in the set would carry
  // them into the next selection.
  useEffect(() => {
    if (result?.ok) setSelected(new Set());
  }, [result]);
  const toggle = (reviewId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reviewId)) next.delete(reviewId);
      else next.add(reviewId);
      return next;
    });
  };
  return (
    <SelectionContext.Provider value={{ selected, toggle, result, publish }}>
      {children}
    </SelectionContext.Provider>
  );
}

function useSelection() {
  const context = useContext(SelectionContext);
  if (!context) throw new Error("Review bulk-publish control used outside its provider");
  return context;
}

/**
 * Renders its own wrapping `<label>` (rather than trusting a caller's) so the
 * input/label association stays inside this file, where the lint rule
 * requiring it can see it. The 44px box is the tap target, not the ~16px
 * checkbox (docs/design/principles.md #2).
 */
export function ReviewSelectCheckbox({
  reviewId,
  ariaLabel,
}: {
  reviewId: string;
  ariaLabel: string;
}) {
  const { selected, toggle } = useSelection();
  return (
    <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        checked={selected.has(reviewId)}
        onChange={() => toggle(reviewId)}
        aria-label={ariaLabel}
        className="size-4 shrink-0"
      />
    </label>
  );
}

/**
 * The bulk submit. Posts the ticked ids as repeated `reviewIds` fields; an
 * empty tick list still submits, and the action answers with its own "nothing
 * selected" refusal rather than the button pretending to be broken.
 */
export function PublishSelectedButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { selected, publish } = useSelection();
  return (
    <form action={publish}>
      {[...selected].map((reviewId) => (
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
  noneSelected: string;
  error: string;
};

/**
 * What the last pass did, on the list it changed.
 *
 * **Rendered unconditionally**, which is the whole point: a bulk publish has no
 * single control to sit beside — what moved is N rows across the list — so its
 * home is the list's own header row, and the case that most needs a sentence is
 * the one that clears the queue and takes the button away with it.
 */
export function PublishSelectedStatus({
  copy,
  className = "",
}: {
  copy: BulkPublishCopy;
  className?: string;
}) {
  const { result } = useSelection();
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
      {result.reason === "none-selected" ? copy.noneSelected : copy.error}
    </FormStatus>
  );
}
