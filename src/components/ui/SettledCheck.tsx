"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { SETTLED_MARK_GAP, SETTLED_MARK_SIZE } from "./settled-mark";

/**
 * The mark a thing wears once it has settled — a station whose head count has
 * closed, a diver checked in at the counter, a step of the diver's thread that
 * is done.
 *
 * Drawn, never an emoji: ADR 20260827-clearwater-surface-language's
 * accessibility commitments make a drawn SVG the rule for anything new, and
 * the stroke weight and round caps here are the shared icon set's
 * (`StaffDestinationIcon.tsx`) so one hand drew all of them.
 *
 * **The label always renders.** Colour and shape never carry a state alone, so
 * this component has no way to be used as a bare tick — the word is a required
 * prop, not an option. Callers pass a string from their own bundle; this file
 * holds no copy.
 *
 * **The motion only ever fires on a transition.** `settle-in` plays when a
 * client-side render turns `settled` from false to true and at no other time —
 * never on the first paint, so a page of forty settled rows does not pop forty
 * marks on arrival. A `prefers-reduced-motion` reader gets the mark swapping
 * with no motion at all, via the kill-switch in globals.css.
 *
 * **What follows the label hangs beside the mark** (pixel-craft class 3,
 * K-593). A status line that says more than its word — Today's settled station:
 * "All home", the count, who closed it — passes the rest as `children`. They
 * join the label in one text block beside the mark, laid out as the line was
 * (each fact an item, 8px apart, a wrapped one moving whole), so a fact that
 * wraps starts under the label. As siblings of this component they started
 * back under the glyph: 38px in, where the label is 65.
 */
export function SettledCheck({
  settled,
  label,
  labelClassName = "",
  className = "",
  children,
}: {
  settled: boolean;
  /** The state in words — always rendered, never optional. */
  label: string;
  /** The label's own type (its weight), apart from the facts that follow it. */
  labelClassName?: string;
  className?: string;
  /** The rest of the status line, set beside the mark after the label. */
  children?: ReactNode;
}) {
  // `null` until the first effect runs, which is what distinguishes "this
  // component just mounted holding `true`" from "it was false a moment ago and
  // has just become true". A `useState` initialiser could not tell those apart:
  // both render `settled === true` on their first pass.
  const previous = useRef<boolean | null>(null);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    const firstPaint = previous.current === null;
    const rose = previous.current === false && settled;
    previous.current = settled;
    if (firstPaint) return;
    if (rose) setSettling(true);
    // A mark that settles and un-settles inside the 200ms — a station whose head
    // count closes and reopens — must not keep animating as the unsettled shape.
    // `onAnimationEnd` cannot clear it: the animation is still running.
    else if (!settled) setSettling(false);
  }, [settled]);

  const mark = (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      onAnimationEnd={() => setSettling(false)}
      className={`${SETTLED_MARK_SIZE} shrink-0 ${settled ? "text-success" : "text-muted"} ${
        settling && settled ? "settle-in" : ""
      }`.trim()}
    >
      <circle cx="12" cy="12" r="9" />
      {settled ? <path d="m8.2 12.3 2.6 2.6 5-5.4" /> : null}
    </svg>
  );
  const word = <span className={labelClassName || undefined}>{label}</span>;

  if (children == null) {
    return (
      <span className={`inline-flex items-center ${SETTLED_MARK_GAP} ${className}`.trim()}>
        {mark}
        {word}
      </span>
    );
  }
  return (
    // The row starts at the top and the mark stands in a box one line tall,
    // so it centres on the first line whatever the line's height.
    <span className={`flex items-start ${SETTLED_MARK_GAP} ${className}`.trim()}>
      <span className="flex h-lh shrink-0 items-center">{mark}</span>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {word}
        {children}
      </span>
    </span>
  );
}
