"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { FormStatus } from "@/components/ui/form";
import type { NoticeTone } from "@/lib/staff-notices";
import { publishReviewsAction } from "../actions";

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
 */
const SelectionContext = createContext<{
  selected: Set<string>;
  toggle: (reviewId: string) => void;
} | null>(null);

export function ReviewSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change clears the selection, which is the point.
  useEffect(() => setSelected(new Set()), [pathname]);
  const toggle = (reviewId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(reviewId)) next.delete(reviewId);
      else next.add(reviewId);
      return next;
    });
  };
  return (
    <SelectionContext.Provider value={{ selected, toggle }}>{children}</SelectionContext.Provider>
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
 * selected" notice rather than the button pretending to be broken.
 */
export function PublishSelectedButton({
  label,
  pendingLabel,
  className,
  status,
}: {
  label: string;
  pendingLabel: string;
  className: string;
  /**
   * What the last bulk publish did — "nothing was ticked", "twelve went
   * live" — already worded by the page. It renders inside this form so the
   * answer arrives beside the button, not in a banner above three stat tiles
   * and a filter row.
   */
  status?: { tone: NoticeTone; text: string };
}) {
  const { selected } = useSelection();
  return (
    <form action={publishReviewsAction} className="flex flex-wrap items-center gap-2">
      {[...selected].map((reviewId) => (
        <input key={reviewId} type="hidden" name="reviewIds" value={reviewId} />
      ))}
      <SubmitButton pendingLabel={pendingLabel} className={className}>
        {label}
      </SubmitButton>
      <FormStatus tone={status?.tone}>{status?.text}</FormStatus>
    </form>
  );
}
