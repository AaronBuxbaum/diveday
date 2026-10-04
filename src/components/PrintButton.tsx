"use client";

import { buttonClass } from "@/components/ui/button";

/**
 * Opens the browser's print dialog for the page it sits on, and never prints
 * itself. `quiet` is the ghost weight a rare door wears beside a row's own
 * facts (the week pager); the default is the bordered button a document's own
 * toolbar carries.
 */
export function PrintButton({ label, quiet = false }: { label: string; quiet?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass(
        quiet
          ? { variant: "ghost", size: "sm", className: "print:hidden" }
          : { variant: "secondary", className: "print:hidden" },
      )}
    >
      {label}
    </button>
  );
}
