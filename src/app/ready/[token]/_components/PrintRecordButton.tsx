"use client";

import { buttonClass } from "@/components/ui/button";

/**
 * Hands the keepsake to the browser's own print dialog — which is also how it
 * becomes a PDF, and how it reaches a paper logbook.
 *
 * The after-state's print pass is what makes that worth a button: everything
 * on the page except the dive record is `print:hidden`, and the record itself
 * gains a ruled Notes block and a divemaster signature rule (ADR
 * 20260827-the-divers-thread, decision 4, slice 7d). The label is the caller's
 * — this file holds no copy — and the emoji it used to prefix is gone, since
 * anything drawn on a new surface is a drawn SVG or nothing at all.
 */
export function PrintRecordButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      {label}
    </button>
  );
}
