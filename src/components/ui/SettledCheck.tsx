"use client";

import { useEffect, useRef, useState } from "react";

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
 */
export function SettledCheck({
  settled,
  label,
  className = "",
}: {
  settled: boolean;
  /** The state in words — always rendered, never optional. */
  label: string;
  className?: string;
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
  }, [settled]);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        onAnimationEnd={() => setSettling(false)}
        className={`size-5 shrink-0 ${settled ? "text-success" : "text-muted"} ${
          settling ? "settle-in" : ""
        }`.trim()}
      >
        <circle cx="12" cy="12" r="9" />
        {settled ? <path d="m8.2 12.3 2.6 2.6 5-5.4" /> : null}
      </svg>
      <span>{label}</span>
    </span>
  );
}
