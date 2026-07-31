"use client";

// i18n-exempt-file: error.tsx is a Next.js file convention with a fixed
// {error, reset} prop signature — the framework instantiates it directly, so
// no Server Component ancestor can pass it a `copy` prop the way every other
// staff Client Component receives its words (src/i18n/staff-messages.ts).
// Bridging server-resolved copy across an error boundary would need new
// context-provider plumbing threaded through the layout for three short,
// rare-path strings; flagged for a follow-up decision rather than invented
// unilaterally, matching trips/[id]/error.tsx's existing precedent.
import { buttonClass } from "@/components/ui/button";

/**
 * The shop-wide backstop — catches a render error on Today and every other
 * staff surface that doesn't already have its own closer boundary (the trip
 * detail tree has one at trips/[id]/error.tsx). Today is the page staff open
 * first every shift, often 90 minutes before a boat leaves; a crash there
 * should offer one big "Try again," not a raw stack trace.
 */
export default function ShopError({ reset }: { error: Error; reset: () => void }) {
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
