"use client";

import { buttonClass } from "@/components/ui/button";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={buttonClass({ variant: "secondary", className: "print:hidden" })}
    >
      {label}
    </button>
  );
}
