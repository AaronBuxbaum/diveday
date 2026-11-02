import type { ReactNode } from "react";
import { Suspense } from "react";
import { RetryReturningDiverMemory } from "@/app/_components/RetryReturningDiverMemory";

/**
 * The trip-prep “I’m ready” page's one addition to the `(token)` layout (which
 * carries the error-boundary provider, `../../layout.tsx`): the returning
 * diver's retry memory, behind its own Suspense so it never holds the page.
 */
export default function ReadyTokenLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <RetryReturningDiverMemory />
      </Suspense>
      {children}
    </>
  );
}
