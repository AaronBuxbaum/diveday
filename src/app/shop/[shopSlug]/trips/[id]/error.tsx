"use client";

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
