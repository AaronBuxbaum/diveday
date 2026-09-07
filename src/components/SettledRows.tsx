"use client";

import { useLayoutEffect, useRef } from "react";
import { motionMs, prefersReducedMotion } from "@/lib/motion";

/**
 * **A row that leaves takes 200ms; the gap it left closed in none** — ADR
 * 20260907-nothing-from-nowhere, decision 3.
 *
 * Two of this app's lists already animate a departing row, and principle 5
 * names one of them as the exit doing real explanatory work. Neither ever
 * animated the rows *around* it: the counter's row sank over 200ms and every
 * name beneath it jumped a row height in a single frame, so the one thing that
 * moved instantly was the thing the eye was about to read. The row leaving is
 * the answer to "what happened"; the rows closing over it are the answer to
 * "where did everything else go", and until now the second question went
 * unanswered on the surface a shop uses most.
 *
 * This wraps a list and animates that second half. It is FLIP, the same
 * technique `SegmentedControl` already uses to slide its pill: read where each
 * row is before the browser paints the new arrangement, put it back where it
 * was with a transform, then release it. **Nothing the browser lays out is
 * animated** — every row is in its final position the whole time, wearing an
 * offset that decays to zero, which is the same rule the disclosure body and
 * the progress bar are held to.
 *
 * **Rows are tracked by DOM identity, not by a key attribute.** React reuses
 * the same element for a keyed row across a re-render, so a `WeakMap` keyed on
 * the node itself knows which rows survived without every list having to
 * label its children — and a row that was genuinely replaced has no previous
 * position, which is exactly the right answer for one that just arrived.
 *
 * A reader who asked for reduced motion gets the jump, and this measures
 * nothing on their behalf: the stylesheet's kill-switch would shorten the
 * transition to nothing while every `getBoundingClientRect` still ran.
 */
export function SettledRows({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useSettledRows(container);
  return (
    <div ref={container} className={className}>
      {children}
    </div>
  );
}

/**
 * The measuring half, separated so a list that already owns its container
 * element can slide its rows without wrapping them in another `<div>`.
 *
 * Runs on every commit rather than on a dependency list: the lists this serves
 * are server-rendered and arrive as new children after a revalidation, so
 * there is no prop here to depend on — the DOM *is* the change.
 */
export function useSettledRows(container: React.RefObject<HTMLElement | null>): void {
  const positions = useRef(new WeakMap<Element, number>());

  // Layout effect, not an effect: this has to run in the commit where the new
  // arrangement exists and before the browser paints it, or the reader sees
  // the rows in their new places for one frame and *then* watches them travel
  // back and forth.
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const rows = [...root.children].filter((row): row is HTMLElement => row instanceof HTMLElement);

    // Positions are read relative to the list's own box, never to the viewport:
    // a page that scrolled, or a panel above this one that grew, moves every
    // row equally and is not this list rearranging itself.
    const top = root.getBoundingClientRect().top;
    const measure = (row: HTMLElement) => row.getBoundingClientRect().top - top;

    if (prefersReducedMotion()) {
      for (const row of rows) positions.current.set(row, measure(row));
      return;
    }

    const moved: Array<[HTMLElement, number]> = [];
    for (const row of rows) {
      const now = measure(row);
      const before = positions.current.get(row);
      if (before !== undefined && Math.abs(before - now) > 0.5) moved.push([row, before - now]);
      positions.current.set(row, now);
    }
    if (moved.length === 0) return;

    // Invert: put every row back where the reader last saw it, with no
    // transition, so the browser treats this as a starting position rather
    // than as somewhere to travel to.
    for (const [row, delta] of moved) {
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;
    }
    // One forced reflow is what separates "set" from "transition to" — the same
    // line, for the same reason, as the segmented control's moving pill.
    void root.offsetWidth;
    for (const [row] of moved) {
      row.style.transition = `transform ${motionMs("base")}ms var(--ease-out-soft)`;
      row.style.transform = "";
    }
    // The inline transition is deliberately left behind rather than cleaned up
    // on a timer: a timer racing a running animation is what cuts a fold off
    // partway, and a row that keeps a transform transition is a row ready for
    // the next time the list moves.
  });
}
