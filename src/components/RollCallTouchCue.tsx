"use client";

import { type CSSProperties, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { TOUCH_REFUSED_EVENT } from "./roll-call-touch-guard";

/** How long the line stays: read at a glance, gone before the next name. */
export const ROLL_CALL_TOUCH_CUE_MS = 2500;

/**
 * The attribute the live manifest's pinned count card wears (`PanelHeight`),
 * so the line can sit just under it rather than over the head count.
 */
export const ROLL_CALL_PANEL_ATTRIBUTE = "data-roll-call-panel";

/** Below the bar, where no control is, when there is no card to clear. */
const TOP_OF_SCREEN = "calc(var(--chrome-h, 0px) + 1rem)";

/**
 * Where the line goes for a press refused on `control`: just under the pinned
 * count card while it is on screen, so the head count stays readable; at the
 * top otherwise, which is also where it goes when the press was inside the
 * person sheet, whose backdrop covers the card anyway.
 */
export function rollCallTouchCueTop(control: Element | null): string {
  if (control?.closest('[role="dialog"]')) return TOP_OF_SCREEN;
  const card = document.querySelector(`[${ROLL_CALL_PANEL_ATTRIBUTE}]`);
  const bottom = card?.getBoundingClientRect().bottom ?? 0;
  return bottom > 0 ? `${Math.ceil(bottom) + 8}px` : TOP_OF_SCREEN;
}

/**
 * The cues mounted in this document, oldest first. Only the oldest answers:
 * the paper-day page draws one manifest per departure, and N cues would say
 * one refusal N times.
 */
const mounted: string[] = [];

/**
 * **The words that go with a refused roll-call press** (issue #2328).
 *
 * The touch guard (`roll-call-touch-guard.ts`) refuses a press made under a
 * wet palm or spray and puts the cue on the control itself; this says why:
 * "Tap again with one finger". Mounted by the live manifest's diver list and by
 * the offline copy, fed by the guard's own event so the two say the same thing
 * for the same refusal, and answered by one cue per document however many are
 * mounted.
 *
 * **Never in the way.** The app's toast sits at the foot of the screen, which
 * on the roll call is exactly where the person sheet's controls are, and the
 * top of the screen is the pinned head count. This line sits just under that
 * card, takes no taps (`pointer-events-none`), and does not move.
 *
 * Words only. It never submits anything: the crew taps again, or nobody does.
 */
export function RollCallTouchCue({ message }: { message: string }) {
  const id = useId();
  // A fresh line per refusal (the key below), so a second palm still lands.
  const [refusal, setRefusal] = useState<{ count: number; top: string } | null>(null);
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    mounted.push(id);
    const heard = (event: Event) => {
      if (mounted[0] !== id) return;
      const control = event.target instanceof Element ? event.target : null;
      setRefusal((last) => ({ count: (last?.count ?? 0) + 1, top: rollCallTouchCueTop(control) }));
      setShowing(true);
    };
    document.addEventListener(TOUCH_REFUSED_EVENT, heard);
    return () => {
      document.removeEventListener(TOUCH_REFUSED_EVENT, heard);
      mounted.splice(mounted.indexOf(id), 1);
    };
  }, [id]);
  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(() => setShowing(false), ROLL_CALL_TOUCH_CUE_MS);
    return () => clearTimeout(timer);
  }, [refusal]);
  const position: CSSProperties = { top: refusal?.top ?? TOP_OF_SCREEN };
  // Into `body`, so it paints over an open person sheet (itself portalled
  // there) rather than under its backdrop.
  return showing && refusal
    ? createPortal(
        <div
          style={position}
          className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 print:hidden"
        >
          <p
            key={refusal.count}
            role="status"
            className="rounded-inset border border-warning bg-warning-tint px-4 py-3 text-base font-semibold text-warning-strong shadow-2xl"
          >
            {message}
          </p>
        </div>,
        document.body,
      )
    : null;
}
