"use client";

import { useEffect } from "react";

/**
 * Tells the loader on the shop's site how tall this widget is, so the frame
 * it sits in grows to fit and never scrolls inside the page (Harbor — ADR
 * 20260901-diveday-reimagined). The message carries one number and nothing
 * else; the loader believes it only from DiveDay's own origin.
 */
export function EmbedHeightReporter() {
  useEffect(() => {
    if (window.parent === window) return;
    const report = () => {
      window.parent.postMessage(
        { type: "diveday:height", height: document.documentElement.scrollHeight },
        "*",
      );
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  return null;
}
