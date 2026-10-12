"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TOUCH_REFUSED_EVENT } from "./roll-call-touch-guard";

/** How long the line stays: read at a glance, gone before the next name. */
export const ROLL_CALL_TOUCH_CUE_MS = 2500;

/**
 * **The words that go with a refused roll-call press** (issue #2328).
 *
 * The touch guard (`roll-call-touch-guard.ts`) refuses a press made under a
 * wet palm or spray and puts the cue on the control itself; this says why, once
 * per surface: "Tap again with one finger". Mounted once by the live
 * manifest's diver list and once by the offline copy, and fed by the guard's
 * own event, so the two say the same thing for the same refusal.
 *
 * **At the top, and never in the way.** The app's toast sits at the foot of
 * the screen, which on the roll call is exactly where the person sheet's
 * controls are: it covered "Not back aboard" for as long as it showed. This
 * line takes no taps (`pointer-events-none`) and sits where no control is.
 *
 * Words only. It never submits anything: the crew taps again, or nobody does.
 */
export function RollCallTouchCue({ message }: { message: string }) {
  // A fresh line per refusal (the key below), so a second palm still lands.
  const [refusals, setRefusals] = useState(0);
  const [showing, setShowing] = useState(false);
  useEffect(() => {
    const heard = () => {
      setRefusals((count) => count + 1);
      setShowing(true);
    };
    document.addEventListener(TOUCH_REFUSED_EVENT, heard);
    return () => document.removeEventListener(TOUCH_REFUSED_EVENT, heard);
  }, []);
  useEffect(() => {
    if (refusals === 0) return;
    const timer = setTimeout(() => setShowing(false), ROLL_CALL_TOUCH_CUE_MS);
    return () => clearTimeout(timer);
  }, [refusals]);
  // Into `body`, so it paints over an open person sheet (itself portalled
  // there) rather than under its backdrop.
  return showing
    ? createPortal(
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 print:hidden">
          <p
            key={refusals}
            role="status"
            className="rise-in rounded-inset border border-warning bg-warning-tint px-4 py-3 text-base font-semibold text-warning-strong shadow-2xl"
          >
            {message}
          </p>
        </div>,
        document.body,
      )
    : null;
}
