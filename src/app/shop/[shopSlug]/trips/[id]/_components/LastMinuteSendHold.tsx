"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  holdSendAction,
  releaseHeldSendAction,
  undoHeldSendAction,
} from "@/app/actions/held-sends";
import { SendHold, type SendHoldCopy } from "@/components/SendHold";

/**
 * The last-minute deal's form, as a held send (ADR 20260906-before-you-ask,
 * decision 2). The tap holds the blast for eight seconds with Undo in the row;
 * once it leaves, the surface goes where the old immediate action redirected —
 * the section's own anchor, carrying the notice the outcome earned.
 */
export function LastMinuteSendHold({
  tripId,
  copy,
  className,
  children,
}: {
  tripId: string;
  copy: SendHoldCopy;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <SendHold
      className={className}
      hold={holdSendAction}
      undo={undoHeldSendAction}
      release={releaseHeldSendAction}
      onOutcome={(outcome) => {
        if (outcome.redirectTo) router.push(outcome.redirectTo);
      }}
      copy={copy}
    >
      <input type="hidden" name="holdKind" value="last_minute_deal" />
      <input type="hidden" name="tripId" value={tripId} />
      {children}
    </SendHold>
  );
}
