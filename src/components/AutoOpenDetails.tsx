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
  open,
  className,
  children,
}: {
  /** The fragment (no leading "#") of an anchor inside `children` — the id
   * belongs to that inner element, not to this `<details>` itself. */
  openOnHash: string;
  /** Server-decided initial state (e.g. "this section just saved") — the hash
   * check can only ever open, never close, so the two compose. */
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const sync = () => {
      if (window.location.hash === `#${openOnHash}`) {
        const details = ref.current;
        if (details) details.open = true;
      }
    };
    sync();
    // A client navigation that changes only the hash on an already-mounted
    // list (Today → #booking-A, back, Today → #booking-B) re-runs no mount
    // effect, so listen for the change too — otherwise the second deep link's
    // target stays collapsed.
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [openOnHash]);

  return (
    <details ref={ref} open={open} className={className}>
      {children}
    </details>
  );
}
