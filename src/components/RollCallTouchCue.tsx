"use client";

import { useEffect, useState } from "react";
import { TOUCH_REFUSED_EVENT } from "./roll-call-touch-guard";
import { Toast } from "./Toast";

/** How long the line stays: read at a glance, gone before the next refusal piles up. */
export const ROLL_CALL_TOUCH_CUE_MS = 2500;

/**
 * **The words that go with a refused roll-call press** (issue #2328).
 *
 * The touch guard (`roll-call-touch-guard.ts`) refuses a press made under a
 * wet palm or spray and puts the cue on the control itself; this says why, once
 * per surface, in the app's one toast: "Tap again with one finger". Mounted
 * once by the live manifest and once by the offline copy, and fed by the
 * guard's own event, so the two say the same thing for the same refusal.
 *
 * Words only. It never submits anything: the crew taps again, or nobody does.
 */
export function RollCallTouchCue({ message }: { message: string }) {
  // A fresh toast per refusal, so a second palm still visibly lands.
  const [refusals, setRefusals] = useState(0);
  useEffect(() => {
    const heard = () => setRefusals((count) => count + 1);
    document.addEventListener(TOUCH_REFUSED_EVENT, heard);
    return () => document.removeEventListener(TOUCH_REFUSED_EVENT, heard);
  }, []);
  return refusals > 0 ? (
    <Toast key={refusals} message={message} durationMs={ROLL_CALL_TOUCH_CUE_MS} />
  ) : null;
}
