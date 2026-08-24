"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The closing-state pattern the schedule board's row menu built for itself
 * (`ScheduleBuilder.tsx`'s `MENU_CLOSE_MS` / `closingMenu`), generalized to
 * any overlay that wants its exit animation to finish before React unmounts
 * it — issue #832: every overlay in the app except the row menu and the two
 * toasts popped in on `open` and vanished in one frame on close, because an
 * entrance is free in React and an exit is not: the element has to survive
 * its own removal.
 *
 * A closing overlay must keep the DOM node mounted for `durationMs` while
 * swapping in the exit animation class, then actually unmount — this hook is
 * that timer and that boolean, declared together so they can never drift the
 * way a hand-written `setTimeout` and a CSS `animation-duration` in a
 * different file can (the exact failure `MENU_CLOSE_MS`'s own comment warns
 * about: "has to outlast the last child's delay + duration").
 *
 * **Entrance must stay synchronous** — `mounted` cannot lag `open` by even
 * one render, or an effect that focuses the newly-mounted content on `open`
 * (the command palette's own "focus the input") fires before the content
 * exists. The first version of this hook set `mounted` from a `useEffect`
 * reacting to `open`, which inserted exactly that one-render gap and broke
 * the palette's autofocus in e2e (issue #832 review). `mounted` is now a
 * plain derived value, `open || closing`, computed every render directly
 * from the caller's own `open` — no state, no delay. Only `closing` needs
 * React's timer-driven state, and it is set *during render* rather than in
 * an effect (React's documented "adjust state when a prop changes" pattern:
 * https://react.dev/learn/you-might-not-need-an-effect), which is what keeps
 * the render where `open` goes from `true` to `false` already showing
 * `closing`, rather than a `mounted=false` frame followed by a remount.
 *
 * `prefers-reduced-motion` is read here, not left to the caller, because it
 * is the specific failure mode this hook exists to own: the global kill
 * switch (`globals.css`) shortens `animation-duration` to near-zero but has
 * no way to shorten a JS timer in a different file, so a reduced-motion
 * reader would otherwise watch a closed overlay sit inert for the animation's
 * full un-shortened duration before it finally unmounts.
 *
 * Usage:
 * ```tsx
 * const { mounted, closing } = useExitAnimation(open, 180);
 * return mounted ? (
 *   <div className={closing ? "animate-scale-out" : "animate-scale-in"}>…</div>
 * ) : null;
 * ```
 */
export function useExitAnimation(
  open: boolean,
  durationMs: number,
): { mounted: boolean; closing: boolean } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const prevOpen = useRef(open);

  // Render-phase state adjustment, not an effect: comparing against a ref and
  // conditionally calling a setter here is safe and React-endorsed for
  // exactly this "start a transition the instant a prop changes" shape.
  // React re-renders this component immediately, before painting, with the
  // ref write already applied — so by the time anything commits, `closing`
  // already reflects the new `open` value, and `mounted` below is correct on
  // the very first render of the transition.
  //
  // The reduced-motion read has to live in this same synchronous branch,
  // not in the effect that starts the timer below: an effect runs *after*
  // the browser paints, so deciding there would let a reduced-motion reader
  // see the closing element flash onto the screen for one frame before the
  // effect immediately closed it again — the exact inert-overlay failure
  // this hook exists to prevent, just moved earlier by one frame. Deciding
  // now means a reduced-motion close never sets `closing` at all, so
  // `mounted` goes straight to `false` in the same render as `open`.
  if (prevOpen.current !== open) {
    prevOpen.current = open;
    if (open) {
      window.clearTimeout(timer.current);
      if (closing) setClosing(false);
    } else {
      // `matchMedia` is unavailable on the server and in some test
      // environments (jsdom does not implement it by default) — fail toward
      // showing the animation rather than toward silently skipping it, the
      // same direction every other "can't tell" default in this app leans.
      const reduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) setClosing(true);
    }
  }

  const mounted = open || closing;

  useEffect(() => {
    if (!closing) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setClosing(false), durationMs);
    return () => window.clearTimeout(timer.current);
  }, [closing, durationMs]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { mounted, closing };
}
