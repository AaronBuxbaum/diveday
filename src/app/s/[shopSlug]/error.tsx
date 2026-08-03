"use client";

// i18n-exempt-file: error.tsx is a Next.js file convention with a fixed
// {error, reset} prop signature — the framework instantiates it directly, so no
// Server Component ancestor can pass it a `copy` prop the way every other diver
// Client Component gets its words (through DiverIntlProvider). Bridging
// server-resolved copy across an error boundary would need new provider
// plumbing for three short, rare-path strings; same call, and same flagged
// follow-up, as shop/[shopSlug]/error.tsx.
import { buttonClass } from "@/components/ui/button";

/**
 * The diver-side backstop. These pages inherited `/shop/[shopSlug]/error.tsx`
 * before the public surfaces moved into their own namespace (ADR
 * 20260803-public-shop-namespace); without a boundary of their own a render
 * error on a booking page would escalate to `global-error.tsx` and replace the
 * whole document. A diver mid-booking gets one obvious "Try again" instead.
 */
export default function PublicShopError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">That didn’t go through</h1>
      <p className="mt-3 text-muted">
        Something went wrong loading this page. Nothing was booked — tap to try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className={buttonClass({ size: "cta", className: "mt-6" })}
      >
        Try again
      </button>
    </main>
  );
}
