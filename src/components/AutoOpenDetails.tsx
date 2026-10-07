"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

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
  id,
  name,
  className,
  onToggle,
  children,
}: {
  /** The fragment (no leading "#") this disclosure answers to — usually an
   * anchor inside `children`, or this element itself when `id` names it. */
  openOnHash: string | string[];
  /** Server-decided initial state (e.g. "this section just saved") — the hash
   * check can only ever open, never close, so the two compose. Like the hash,
   * it only ever opens: a later render where it reads false (the `?notice=`
   * that held a roster row open has been cleared from the URL) leaves the
   * disclosure as the reader has it, rather than snapping it shut under them. */
  open?: boolean;
  /** The `<details>`'s own fragment target, when the anchor *is* this element
   * — a deep link then scopes to the whole disclosure, and the hash check
   * below is what opens it (the native reveal only opens a target's
   * ancestors). */
  id?: string;
  /**
   * The exclusive-accordion group (the native `<details name>`): opening one
   * member closes the rest, with no listener and no state. The diver's thread
   * uses it so at most one step is ever open — see `/ready/[token]/page.tsx`.
   */
  name?: string;
  className?: string;
  /** Told whether the disclosure is now open, however it opened. */
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // The attribute React renders is the first one it saw, so it never has a
  // reason to patch `open` away; a later `true` opens it imperatively below.
  const [initialOpen] = useState(open);

  // Only a later `true` opens it: the first render already drew the attribute,
  // and re-asserting it on mount would undo a tap made before hydration. In a
  // `name` accordion that tap closed this one to open its sibling, and opening
  // this one again on mount shut the sibling the reader chose (/ready streams
  // its thread in, so the tap can land first).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current && ref.current) ref.current.open = true;
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    const hashes = Array.isArray(openOnHash) ? openOnHash : [openOnHash];
    const sync = () => {
      if (hashes.some((hash) => window.location.hash === `#${hash}`)) {
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
    <details
      ref={ref}
      id={id}
      name={name}
      open={initialOpen}
      className={className}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
    >
      {children}
    </details>
  );
}
