"use client";

import { Children, isValidElement, useEffect, useRef, useState } from "react";
import { motionMs, prefersReducedMotion } from "@/lib/motion";

/**
 * **A count that changes in front of a person rolls; every other figure
 * swaps** — ADR 20260907-nothing-from-nowhere, decision 3.
 *
 * The counter's instrument line went from "6 of 10 here" to "7 of 10 here" in a
 * single frame while the meter beneath it took 200ms to grow and the dial on
 * the manifest took 300ms to fill. One change, two answers, and the one a
 * staffer actually reads was the one that did not move — so the tap that
 * landed and the page that re-rendered for some other reason looked identical.
 *
 * Only the digits that *changed* move: the old one leaves upward and the new
 * one arrives from below, over `--motion-base`, on the exit and arrival curves
 * respectively. Everything that is not a digit is drawn as ordinary text, so
 * the words beside a figure keep their own line breaking and never move, and a
 * count going *down* rolls down — which is how the eye tells an undo from a
 * second check-in without reading either.
 *
 * **What it will not do, and why each is deliberate:**
 *
 * - **A first paint swaps.** The previous value comes from this component's own
 *   last render, never from a prop, so a figure that mounts with a value has
 *   nothing to say: nothing changed in front of the reader. That is also what
 *   keeps a server-rendered page from playing an animation on hydration.
 * - **A changed sentence swaps.** If anything but the digits differs — a plural
 *   form flipping, a currency symbol arriving, "3 to come" becoming "1 to
 *   come · 2 can't board yet" — the figure is not the same statement any more,
 *   and rolling digits inside a sentence that rewrote itself claims a
 *   continuity that is not there.
 * - **A reduced-motion reader swaps**, decided here rather than left to the
 *   stylesheet's kill-switch: the switch would run the roll in 0.01ms, which is
 *   a swap with two extra DOM nodes and a needless class change.
 * - **A head count never rolls at all.** Not the roll call's, not the
 *   manifest's dial — under either answer to H-69 c. A digit mid-roll is
 *   neither number for 200ms, on the one figure a crew reads in glare to decide
 *   whether a boat leaves with everybody on it.
 *   `RollingFigure.never-list.test.tsx` walks those trees and fails on any
 *   import of this file, because the rule is one nobody should have to
 *   remember while shipping a manifest change.
 *
 * **Accessibility.** The leaving digit is `aria-hidden`, so the accessible name
 * of the figure is the new value from the first frame — a digit on its way out
 * is a visual artefact, not a fact. Nothing here announces: no live region is
 * added, because the surfaces that need to announce a change already own that
 * decision, and a figure that announced itself would talk over them.
 *
 * ```tsx
 * <RollingFigure className={FIGURE_HERO_CLASS}>{formatted}</RollingFigure>
 * ```
 *
 * The child is text that has already been formatted for the reader's locale —
 * this component never formats a number, so ICU's own output (`{here}` in a
 * message, a money string, a countdown) arrives here as characters and leaves
 * as the same characters. A child it cannot read as text renders untouched and
 * does not roll, which is the honest fallback for a value it cannot compare.
 */
export function RollingFigure({
  children,
  className = "",
}: {
  /** Already-formatted text. Digits roll; everything else is drawn as it is. */
  children: React.ReactNode;
  className?: string;
}) {
  const text = textOf(children);
  const previous = useRef<string | null>(null);
  // A render's own "what did this replace?" has to survive until the exit
  // animation ends, and it ends on a timer rather than on the element
  // unmounting — so the leaving text is state, cleared when the roll is over,
  // rather than a value derived from the ref on every render.
  const [leaving, setLeaving] = useState<string | null>(null);

  // Render-phase comparison, the same shape `useExitAnimation` uses and for the
  // same reason: an effect runs after paint, so deciding there would show the
  // new digit in place for one frame and *then* start it arriving from below.
  if (text !== null && previous.current !== text) {
    const before = previous.current;
    previous.current = text;
    // A first paint has nothing to say, and a reader who asked for less motion
    // has said not to say it.
    if (before !== null && !prefersReducedMotion() && leaving !== before) {
      setLeaving(before);
    }
  }

  useEffect(() => {
    if (leaving === null) return;
    const timer = window.setTimeout(() => setLeaving(null), motionMs("base"));
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (text === null) return <span className={className}>{children}</span>;

  // Roll only when this is the same statement with a different number in it.
  const rolling = leaving !== null && skeletonOf(leaving) === skeletonOf(text);
  if (!rolling) return <span className={className}>{text}</span>;

  const before = digitsOf(leaving);
  const after = digitsOf(text);
  const down = Number(after) < Number(before);
  let seen = 0;

  return (
    <span className={className}>
      {[...text].map((char, index) => {
        if (!DIGIT.test(char)) return char;
        // Count columns from the right: "9" becoming "10" gains a digit on the
        // left, and a left-anchored comparison would call every column changed
        // and roll the whole figure for a change of one.
        const fromRight = after.length - seen;
        seen += 1;
        const was = before[before.length - fromRight] ?? null;
        // A stable key per column, so React keeps a settled digit's DOM node
        // and only the changed columns mount fresh, animating ones.
        const key = `${index}-${char}-${was ?? ""}`;
        if (was === char) {
          return (
            <span key={key} className="rolling-figure-slot">
              {char}
            </span>
          );
        }
        return (
          <span key={key} className="rolling-figure-slot">
            {was === null ? null : (
              <span
                aria-hidden="true"
                className={down ? "rolling-digit-out-down" : "rolling-digit-out"}
              >
                {was}
              </span>
            )}
            <span className={down ? "rolling-digit-in-down" : "rolling-digit-in"}>{char}</span>
          </span>
        );
      })}
    </span>
  );
}

const DIGIT = /\d/;

/** The digits of a figure, in order: what actually changed. */
function digitsOf(text: string): string {
  return text.replace(/\D+/g, "");
}

/** Everything that is not a digit: the sentence the figure sits in. */
function skeletonOf(text: string): string {
  return text.replace(/\d+/g, "");
}

/**
 * The text a node draws, or `null` when it draws something this component has
 * no business taking apart.
 *
 * ICU hands a rich-text chunk over as a string, a number, or a one-element
 * array of either — never as markup, for a message whose tag wraps a single
 * placeholder. Anything else (an element, a fragment with children of its own)
 * is a figure with structure, and structure is not something to re-key per
 * character.
 */
function textOf(node: React.ReactNode): string | null {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node) || isValidElement(node)) {
    const parts = Children.toArray(node);
    if (parts.length === 0) return null;
    if (parts.some((part) => typeof part !== "string" && typeof part !== "number")) return null;
    return parts.join("");
  }
  return null;
}
