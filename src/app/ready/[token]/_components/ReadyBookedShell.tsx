import { type ReactNode, Suspense } from "react";
import { ReadyBookedPage } from "./ReadyMasthead";
import { ReadyThreadBodySkeleton } from "./ReadyThreadBodySkeleton";

type ReadyBookedShellProps = Parameters<typeof ReadyBookedPage>[0] & {
  children: ReactNode;
};

/** Keeps the immediate booked masthead above the streaming readiness thread. */
export function ReadyBookedShell({ card, locale, dateActions, children }: ReadyBookedShellProps) {
  return (
    <ReadyBookedPage card={card} locale={locale} dateActions={dateActions}>
      <Suspense fallback={<ReadyThreadBodySkeleton />}>{children}</Suspense>
    </ReadyBookedPage>
  );
}

export function ReadyThreadFallback() {
  return <ReadyThreadBodySkeleton />;
}
