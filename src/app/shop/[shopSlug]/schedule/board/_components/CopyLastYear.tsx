"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { copyLastYearWeekAction } from "../copy-week-actions";

/** What the week carries about the same week a year before (fifth loop, item 30). */
export type LastYearWeekView = {
  /** "Same week last year: 54 of 80"; null until the shop has that week. */
  lastYearTally?: string | null;
  /** "Last year this week: 6 departures." and its one act, on an empty week to come. */
  copyLastYear?: { line: string; label: string; pending: string; weekStart: string } | null;
};

/** Last year's tally, beside this week's; nothing without that history. */
export function LastYearTally({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p data-week-last-year="" className="text-sm text-muted tabular-nums">
      {text}
    </p>
  );
}

/**
 * **"Last year this week: 6 departures. Copy them here"** (fifth loop, item
 * 30): an empty week still to come, where last year had boats, offers them
 * back in one act. The action refuses a week that is no longer empty, so a
 * second tap copies nothing twice.
 */
export function CopyLastYear({
  copy,
  shopSlug,
}: {
  /** Null for a reader who does not build the board, or a week with nothing to offer. */
  copy: LastYearWeekView["copyLastYear"];
  shopSlug: string;
}) {
  if (!copy) return null;
  return (
    <form
      data-week-copy-last-year=""
      action={copyLastYearWeekAction.bind(null, shopSlug)}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-2 pt-6 text-sm print:hidden"
    >
      <input type="hidden" name="weekStart" value={copy.weekStart} />
      <p className="text-muted">{copy.line}</p>
      <SubmitButton
        pendingLabel={copy.pending}
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {copy.label}
      </SubmitButton>
    </form>
  );
}
