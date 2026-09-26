"use client";

import { useEffect, useRef } from "react";

/** The custom property `globals.css` pads the viewport's bottom by. */
const HEIGHT_VAR = "--sticky-actions-h";

/**
 * **Tells the page how tall its sticky Save bar stands right now.**
 *
 * `globals.css` insets the scrollport's bottom by the bar
 * (`html:has([data-sticky-actions])`), so a field Tab moves to lands above it.
 * A fixed inset was the bar's one-row height, 73px, and the bar is a wrapping
 * row: both callers put Save and an unsaved-changes sentence in it, and at
 * 390 the sentence wraps under Save whenever the form is dirty, which is
 * whenever someone is tabbing through it — a 105px bar over a 73px inset,
 * a focused field about 32px under it (K-01). A refusal in the same row grows
 * it again. So the bar measures itself, on every resize, and writes its
 * height to `--sticky-actions-h` on `<html>`; the stylesheet falls back to the
 * one-row height until it has (the server's paint, a browser with no
 * `ResizeObserver`). The property goes when the bar does.
 *
 * It renders one `hidden` span inside the bar and measures its parent: a
 * hidden element is no flex item, so it takes no gap in the bar's row (an
 * empty one would push Save 12px along), and the bar itself stays server-
 * rendered. One bar per page, which is what both callers have.
 */
export function StickyActionsInset() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = probe.current?.parentElement;
    if (!bar) return;
    const root = document.documentElement;
    const write = () => {
      root.style.setProperty(HEIGHT_VAR, `${bar.getBoundingClientRect().height}px`);
    };
    write();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(write);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, []);
  return <span ref={probe} hidden />;
}
