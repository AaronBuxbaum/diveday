"use client";

import { buttonClass } from "@/components/ui/button";

/**
 * Triggers the browser's native print dialog to preserve the dive logbook entry.
 * Print-specific stylesheets produce a clean, keepsake document.
 */
export function PrintRecordButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass({ variant: "secondary", size: "sm" })}
    >
      <span aria-hidden="true">🖨️</span>
      <span className="ms-1.5">{label}</span>
    </button>
  );
}
