"use client";

import type { PropsWithChildren } from "react";
import { useEffect, useRef } from "react";

/** The same fragment target surrounds both the request and its receipt. */
export function MoveAskTarget({ children, className }: PropsWithChildren<{ className: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A native fragment click can find this target in React's hidden stream
    // staging before it is revealed. Hydration finishes that explicit landing
    // only while focus is still on the body, preserving a reader's next control.
    if (window.location.hash === "#move-ask" && document.activeElement === document.body) {
      ref.current?.focus();
    }
  }, []);
  return (
    <div ref={ref} id="move-ask" tabIndex={-1} className={className}>
      {children}
    </div>
  );
}
