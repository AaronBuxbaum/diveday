import type { ReactNode } from "react";
import { Suspense } from "react";
import { RetryReturningDiverMemory } from "@/app/_components/RetryReturningDiverMemory";
import { capabilityPagePrintRule } from "@/lib/print-sheets";

/**
 * The trip-prep “I’m ready” page's one addition to the `(token)` layout (which
 * carries the error-boundary provider, `../../layout.tsx`): the returning
 * diver's retry memory, behind its own Suspense so it never holds the page,
 * and the bearer page's paper margin. Every state of this link prints with no
 * margin, so a browser has nowhere to write the link itself: the day sheet,
 * the logbook, and the moments before the sheet has streamed in or a terminal
 * card that has none (`capabilityPagePrintRule`; issue #2745 review).
 */
export default function ReadyTokenLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style data-capability-print="">{capabilityPagePrintRule()}</style>
      <Suspense fallback={null}>
        <RetryReturningDiverMemory />
      </Suspense>
      {children}
    </>
  );
}
