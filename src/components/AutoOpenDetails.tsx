"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/**
 * A `<details>` that opens itself when the page lands on an anchor inside it.
 *
 * Real (hard) navigation to a same-page `#fragment` runs the browser's own
 * "reveal" algorithm, which opens any closed ancestor `<details>` for you —
 * but a Next.js `<Link>` transition is a client-side route change, not a hard
 * navigation, so that native behavior never fires: the target arrives in the
 * DOM already collapsed. This checks the hash once on mount (covering both a
 * hard load and the client transition that swaps this component in) and
 * opens itself to match.
 */
export function AutoOpenDetails({
  openOnHash,
  className,
  children,
}: {
  /** The fragment (no leading "#") of an anchor inside `children` — the id
   * belongs to that inner element, not to this `<details>` itself. */
  openOnHash: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (window.location.hash === `#${openOnHash}`) {
      const details = ref.current;
      if (details) details.open = true;
    }
  }, [openOnHash]);

  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}
