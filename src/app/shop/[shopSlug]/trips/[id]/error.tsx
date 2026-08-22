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
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the boat surfaces (overview, guests, manifest, prep). A tap
 * that throws on flaky marina Wi-Fi should offer one big "Try again" button,
 * not a raw stack trace — the roll-call actions themselves already return a
 * worded rollback for the common cases, so this only catches the unexpected.
 */
export default function TripError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorPage
      title="That didn’t go through"
      // "loading" was wrong here for the same reason it was on the shop
      // boundary: a tap that throws on marina Wi-Fi did not fail to *load*
      // anything (issue #819). The two say the same words on purpose.
      body="This screen ran into a problem. Your last change may not have saved — tap to try again."
      resetLabel="Try again"
      onReset={reset}
      size="boat"
    />
  );
}
