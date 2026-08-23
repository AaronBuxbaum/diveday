"use client";

// i18n-exempt-file: English by decision, not by deferral — ADR
// 20260803-error-boundary-copy-bridge. The general answer it records is that
// a layout renders *above* error.tsx and can therefore resolve boundary copy
// server-side; the diver bearer-token routes take that answer through
// DiverIntlProvider with a single `errorBoundary` namespace. Staff cannot use
// that mechanism: there is no StaffIntlProvider and staff copy deliberately
// never crosses to the client as a bundle (src/i18n/staff-messages.ts). The
// staff-shaped version is a `copy`-prop context — `staffTranslator` resolves
// three strings in shop/[shopSlug]/layout.tsx, a tiny client provider carries
// them down — which ships no bundle and is the change to make here. Until
// then these three strings stay English; the ADR names this as the known
// remainder rather than an unexamined tradeoff.
import { ErrorPage } from "@/components/ErrorPage";

/**
 * The shop-wide backstop — catches a render error on Today and every other
 * staff surface that doesn't already have its own closer boundary (the trip
 * detail tree has one at trips/[id]/error.tsx). Today is the page staff open
 * first every shift, often 90 minutes before a boat leaves; a crash there
 * should offer one big "Try again," not a raw stack trace.
 */
export default function ShopError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorPage
      title="That didn’t go through"
      // **Not "loading".** This boundary catches a failed render *and* whatever
      // else unwinds through it, and it told the reader the screen failed to
      // load when what had actually failed might be their tap. Saying "this
      // screen ran into a problem" covers both without claiming which — and
      // the sentence after it is the one that matters either way, because the
      // client genuinely cannot know whether a write landed (issue #819).
      body="This screen ran into a problem. Your last change may not have saved — tap to try again."
      resetLabel="Try again"
      onReset={reset}
      size="boat"
    />
  );
}
