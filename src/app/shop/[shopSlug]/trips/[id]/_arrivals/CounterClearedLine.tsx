"use client";

import { useEffect, useRef, useState } from "react";

/** Animate only a client-side false-to-true transition; an already-cleared
 * first render stays static. The instrument mounts this unconditionally so the
 * component can observe that transition.
 */
export function CounterClearedLine({
  cleared,
  children,
}: {
  cleared: boolean;
  /** The words, resolved by the server component above. */
  children: React.ReactNode;
}) {
  // `null` until the first effect runs, which is what distinguishes "this
  // mounted already cleared" from "it cleared a moment ago".
  const previous = useRef<boolean | null>(null);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    const firstPaint = previous.current === null;
    const rose = previous.current === false && cleared;
    previous.current = cleared;
    if (firstPaint) return;
    if (rose) setEntering(true);
    // An undone check-in takes the moment away again; the next one that earns
    // it should animate, so the flag has to fall with the condition.
    else if (!cleared) setEntering(false);
  }, [cleared]);

  if (!cleared) return null;
  return (
    <p
      role="status"
      className={`${entering ? "rise-in " : ""}mt-4 rounded-lg border border-success/30 bg-success-tint px-3 py-2 text-sm font-semibold text-success-strong`}
    >
      {children}
    </p>
  );
}
