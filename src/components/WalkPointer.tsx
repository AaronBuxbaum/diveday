"use client";

import { type CSSProperties, useLayoutEffect, useRef } from "react";

/** One press: the control it lands on (`data-walk-point` inside the page it is drawn in) and when, in ms into the beat. */
export type WalkPress = { target: string; at: number };

/**
 * One fingertip that moves from control to control and presses each in turn, as Priya does on a
 * form: it arrives at the first from the side, then travels from where it last pressed to the next.
 * It measures its page's controls (so it follows any width the drawing is shown at) and hands the
 * positions to the stylesheet (`data-walk-trail`, `globals.css`), which times the moves; only the
 * walk's first phase draws it. The controls' own changes are timed by the caller to the same `at`.
 * Exactly three presses: the form on the waiver slide is the only user.
 */
export function WalkPointer({ presses }: { presses: readonly [WalkPress, WalkPress, WalkPress] }) {
  const ref = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the presses are literals of the drawing
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.parentElement;
    if (!el || !root) return;
    const place = () => {
      const box = root.getBoundingClientRect();
      // The drawing may be scaled; the pointer lives inside it, so positions are in its own pixels.
      const scale = root.offsetWidth > 0 ? box.width / root.offsetWidth : 1;
      presses.forEach((press, i) => {
        const target = root.querySelector(`[data-walk-point="${press.target}"]`);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        el.style.setProperty(`--p${i}x`, `${(rect.left + rect.width / 2 - box.left) / scale}px`);
        el.style.setProperty(`--p${i}y`, `${(rect.top + rect.height / 2 - box.top) / scale}px`);
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const [first, second, third] = presses;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-walk-trail=""
      style={
        {
          "--t0": `${first.at}ms`,
          "--t1": `${second.at}ms`,
          "--t2": `${third.at}ms`,
        } as CSSProperties
      }
    />
  );
}
