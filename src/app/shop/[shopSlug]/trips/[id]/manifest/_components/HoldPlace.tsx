"use client";

import { useLayoutEffect, useRef } from "react";

/** How long after a switch the page above may still settle. */
export const HOLD_MS = 3000;

/** Anything the reader does that means they are moving the page themselves. */
const READER_MOVES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * **Keeps what sits under it still when the page above it changes for a new
 * `holdKey`.** Switching the roll call's checkpoint folds the checklist above
 * the list, and the browser's own scroll anchoring does not always hold the
 * list: the fold lands a few hundred milliseconds after the switch commits,
 * and on CI the list jumped 268px up the screen under the crew's thumb. This
 * marker remembers where it stood before the switch and, whenever the page
 * changes size for a few seconds afterwards, scrolls the window back by however
 * far it moved. It lets go the moment the reader scrolls, taps or types, and
 * only holds a marker that was on screen: below the fold nobody is looking.
 */
export function HoldPlace({ holdKey }: { holdKey: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const committedKey = useRef(holdKey);
  const before = useRef<number | null>(null);
  if (holdKey !== committedKey.current && before.current === null && ref.current) {
    const top = ref.current.getBoundingClientRect().top;
    if (top < window.innerHeight) before.current = top;
  }
  useLayoutEffect(() => {
    if (holdKey === committedKey.current) return;
    committedKey.current = holdKey;
    const start = before.current;
    before.current = null;
    const marker = ref.current;
    if (start === null || !marker) return;
    const hold = () => {
      const moved = marker.getBoundingClientRect().top - start;
      if (moved !== 0) window.scrollBy(0, moved);
    };
    hold();
    const observer = new ResizeObserver(hold);
    observer.observe(document.body);
    const timer = window.setTimeout(release, HOLD_MS);
    for (const event of READER_MOVES) window.addEventListener(event, release, { passive: true });
    function release() {
      observer.disconnect();
      window.clearTimeout(timer);
      for (const event of READER_MOVES) window.removeEventListener(event, release);
    }
    return release;
  }, [holdKey]);
  return <span ref={ref} aria-hidden className="block h-0" />;
}
