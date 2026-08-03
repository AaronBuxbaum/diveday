"use client";

// i18n-exempt-file: the "follow-up decision" this file used to flag is made —
// ADR 20260803-error-boundary-copy-bridge. Boundary copy is resolved in the
// layout above the boundary, not inside it. Diver routes take that through
// DiverIntlProvider with a single `errorBoundary` namespace; staff routes
// cannot, because staff copy never crosses to the client as a bundle
// (src/i18n/staff-messages.ts), so their version is a `copy`-prop context fed
// by `staffTranslator` from shop/[shopSlug]/layout.tsx. That is the change
// this file is waiting on — see shop/[shopSlug]/error.tsx, which carries the
// same three strings and gets converted in the same pass.
import { buttonClass } from "@/components/ui/button";

/**
 * A backstop for the boat surfaces (overview, guests, manifest, prep). A tap
 * that throws on flaky marina Wi-Fi should offer one big "Try again" button,
 * not a raw stack trace — the roll-call actions themselves already return a
 * worded rollback for the common cases, so this only catches the unexpected.
 */
export default function TripError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">That didn’t go through</h1>
      <p className="mt-3 text-muted">
        Something went wrong loading this screen. Your last change may not have saved — tap to try
        again.
      </p>
      <button
        type="button"
        onClick={reset}
        className={buttonClass({ size: "boat", className: "mt-6" })}
      >
        Try again
      </button>
    </main>
  );
}
