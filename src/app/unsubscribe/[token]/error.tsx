"use client";

// i18n-exempt-file: error.tsx is a Next.js file convention with a fixed
// {error, reset} prop signature — the framework instantiates it directly, so
// no Server Component ancestor can pass it a `copy` prop the way every other
// page's words arrive (src/i18n/messages.ts). Same tradeoff as
// verify/[token]/error.tsx and ready/[token]/error.tsx.
import { buttonClass } from "@/components/ui/button";

/**
 * A backstop for the unsubscribe link — a one-tap page opened straight from
 * an inbox. A render error here should offer one clear "Try again," not a
 * raw stack trace on a link the visitor can't easily get back to.
 */
export default function UnsubscribeError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">That didn’t go through</h1>
      <p className="mt-3 text-muted">
        Something went wrong loading this page. Nothing you already did was lost — tap to try again.
      </p>
      <button type="button" onClick={reset} className={buttonClass({ className: "mt-6" })}>
        Try again
      </button>
    </main>
  );
}
