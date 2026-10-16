"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PullToRefresh, type PullToRefreshCopy } from "@/components/PullToRefresh";

/** How long a tap in the queue holds the next refresh off. */
const CHECK_IN_TAP_HOLD_MS = 5 * 1000;

export function CheckInQueueRefresh({
  copy,
  children,
}: {
  copy: PullToRefreshCopy;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // The staff surfaces' `data-hydrated` flag: a disclosure tapped while the
  // queue is still the server's markup does not stay open, so the e2e suite
  // waits on this before opening one straight off a page load.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <div data-check-in-queue="" data-hydrated={hydrated ? "true" : undefined}>
      <PullToRefresh copy={copy} onRefresh={async () => router.refresh()}>
        {children}
      </PullToRefresh>
      {/* The queue fills while it sits on the counter (fifth loop, item 8),
          never in the seconds after a tap. */}
      <LiveRefresh holdAfterTapMs={CHECK_IN_TAP_HOLD_MS} />
    </div>
  );
}
