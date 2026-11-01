"use client";

import { type ReactNode, useId, useState } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/** Fold settled rows below `lg`; unsettled rows stay open, and print keeps the body visible. */
export function FoldBelowLg({
  summary,
  children,
}: {
  /** Folded summary, or null to keep the body open at every width. */
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
