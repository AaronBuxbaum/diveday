"use client";

import { useEffect, useRef, useState } from "react";

/**
 * **Everyone expected is here**, in the success wash (visual review A07: the
 * coral fill read as a warning). It reuses the shipped `checkIn.clearedTitle`
 * words; the count figure beside it deliberately does *not* also celebrate.
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
    // An all-clear in the success wash, never coral or amber, which read as a
    // warning on a phone in the sun (visual review A07).
    <p
      role="status"
      className={`${entering ? "rise-in " : ""}mt-4 rounded-lg border border-success/30 bg-success-tint px-3 py-2 text-sm font-semibold text-success-strong`}
    >
      {children}
    </p>
  );
}
