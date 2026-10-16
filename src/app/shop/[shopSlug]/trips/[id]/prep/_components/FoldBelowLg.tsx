"use client";

import { type ReactNode, useId, useState } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/**
 * **A settled diver's lines, folded on a phone** (issue #2435, decided by the
 * owner 2026-10-13). Below `lg` the body hides behind one row, "All 4
 * assigned", that opens on a tap; from `lg` up the body is always drawn and
 * the row is not. A row that still needs something is never wrapped in this
 * (`assignmentRowIsSettled`): the dock's question is what still needs doing.
 *
 * Folding is CSS, not a media query in script: the server renders the body
 * hidden below `lg` and visible above it, so nothing flashes and a printed
 * packet (which has no `lg`) still carries every line.
 */
export function FoldBelowLg({
  summary,
  children,
}: {
  /** The folded row's words, "All N assigned"; null leaves the body open at every width. */
  summary: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (summary === null) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((was) => !was)}
        className="mt-1 flex min-h-11 w-full items-center gap-2 text-start text-sm text-muted focus-visible:focus-ring-inset lg:hidden print:hidden"
      >
        <DisclosureCaret className={open ? "rotate-90" : ""} />
        <span>{summary}</span>
      </button>
      <div id={bodyId} className={`${open ? "" : "hidden"} lg:block print:block`}>
        {children}
      </div>
    </>
  );
}
