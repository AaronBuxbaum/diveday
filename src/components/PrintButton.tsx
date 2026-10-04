"use client";

import { buttonClass } from "@/components/ui/button";

/**
 * Opens the browser's print dialog for the page it sits on, and never prints
 * itself. `quiet` is the ghost weight a rare door wears beside a row's own
 * facts (the week pager); the default is the bordered button a document's own
 * toolbar carries. `className` adds placement, such as staying off a phone row
 * the door would otherwise wrap.
 */
export function PrintButton({
  label,
  quiet = false,
  className = "",
}: {
  label: string;
  quiet?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass(
        quiet
          ? { variant: "ghost", size: "sm", className: `print:hidden ${className}` }
          : { variant: "secondary", className: `print:hidden ${className}` },
      )}
    >
      {label}
    </button>
  );
}
