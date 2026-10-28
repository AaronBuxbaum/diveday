import { type ReactNode, Suspense } from "react";
import { RememberBooker } from "@/components/RememberBooker";
import { redeemReturningDiverReceipt } from "../returning-diver-actions";
import { ReadyBookedPage } from "./ReadyMasthead";
import { ReadyThreadBodySkeleton } from "./ReadyThreadBodySkeleton";

type ReadyBookedShellProps = Parameters<typeof ReadyBookedPage>[0] & {
  children: ReactNode;
  delivered: boolean;
  justBooked: boolean;
  token: string;
};

/** Keeps the immediate booked masthead above the streaming readiness thread. */
export function ReadyBookedShell({
  card,
  locale,
  dateActions,
  children,
  delivered,
  justBooked,
  token,
}: ReadyBookedShellProps) {
  return (
    <ReadyBookedPage card={card} locale={locale} dateActions={dateActions}>
      {justBooked && !delivered ? (
        <RememberBooker
          shopSlug={card.shop.slug}
          redirectReadinessToken={token}
          redeemReceipt={redeemReturningDiverReceipt}
        />
      ) : null}
      <Suspense fallback={<ReadyThreadBodySkeleton />}>{children}</Suspense>
    </ReadyBookedPage>
  );
}

export function ReadyThreadFallback() {
  return <ReadyThreadBodySkeleton />;
}
