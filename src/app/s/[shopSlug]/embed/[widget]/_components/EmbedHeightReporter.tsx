"use client";

import { useEffect } from "react";

/**
 * Tells the loader on the shop's site how tall this widget is, so the frame
 * it sits in grows to fit and never scrolls inside the page (Harbor — ADR
 * 20260901-diveday-reimagined). The message carries one number and nothing
 * else; the loader believes it only from DiveDay's own origin.
 *
 * `empty` is a widget with nothing to show, which reports exactly 0 once and
 * stops; the loader folds a 0 away, credit and all (#2317). It cannot be
 * measured: an empty page inside a frame is still as tall as the frame,
 * because the root's scroll height never drops below the viewport.
 */
export function EmbedHeightReporter({ empty = false }: { empty?: boolean }) {
  useEffect(() => {
    if (window.parent === window) return;
    const report = () => {
      window.parent.postMessage(
        { type: "diveday:height", height: empty ? 0 : document.documentElement.scrollHeight },
        "*",
      );
    };
    report();
    if (empty) return;
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [empty]);
  return null;
}
