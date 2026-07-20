"use client";

import { buttonClass } from "@/components/ui/button";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass({ variant: "secondary", className: "print:hidden" })}
    >
      Print / save PDF
    </button>
  );
}
