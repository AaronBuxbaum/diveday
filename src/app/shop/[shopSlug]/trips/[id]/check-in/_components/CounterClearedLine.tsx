"use client";

import { useEffect, useRef, useState } from "react";
import { EarnedMomentLine } from "@/components/EarnedMoment";

/**
 * **Everyone expected is here** — the counter's one sanctioned coral moment
 * (ADR 20260827-clearwater-surface-language, decision 11's table, row "The
 * counter"). It reuses the shipped `checkIn.clearedTitle` words and adds no
 * second accent: the count figure beside it deliberately does *not* also
 * celebrate, because a surface renders at most one coral element at a time.
 *
 * **The first-paint guard is the whole reason this is a client component.**
 * `EarnedMomentLine` carries `rise-in`, which is right for a line that appears
 * because of the tap a staffer just made and wrong for a page that loads
 * already complete — a boat cleared an hour ago should not re-celebrate every
 * time somebody opens the counter. So the entrance plays only on a
 * client-side false -> true transition, the same ref guard `SettledCheck`
 * uses, and a page that arrives already cleared renders the line statically.
 *
 * Rendered unconditionally by the instrument (returning `null` when the boat
 * is not clear) so it is mounted *before* the transition it has to notice.
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
    <EarnedMomentLine animate={entering} className="mt-4">
      {children}
    </EarnedMomentLine>
  );
}
