"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken print:hidden"
    >
      Print / save PDF
    </button>
  );
}
