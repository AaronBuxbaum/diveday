"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { motionMs } from "@/lib/motion";

// Matches the `.toast-dismiss` keyframe duration in globals.css. Kept as a
// timer (not `onAnimationEnd`) because the reduced-motion kill-switch there
// only shortens the animation to ~0ms — it doesn't skip it — and we want one
// unmount path that works identically either way.
const EXIT_DURATION_MS = motionMs("base");

/**
 * **The one toast**: pinned above the foot of the screen (and the phone's tab
 * bar), rising in, dismissing itself after a beat, and leaving through the
 * same exit animation. `Toast` and `UndoToast` are both this with different
 * contents, so the two can never land or leave differently.
 *
 * `pausable`: the countdown stops while a reader's mouse or keyboard focus is
 * anywhere in the toast, and resumes from wherever it left off — not a reset
 * to the full duration — once they leave, so tabbing in and out repeatedly
 * can't keep it alive forever. A toast with something to press needs this; one
 * that only says something does not.
 */
export function ToastShell({
  autoDismissMs,
  pausable = false,
  className,
  children,
}: {
  autoDismissMs: number;
  pausable?: boolean;
  /** The box's own layout and inset; the frame, fill and shadow are shared. */
  className: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  const [dismissing, setDismissing] = useState(false);

  // Pending auto-dismiss timer, or null while paused (hover/focus) or once
  // the exit animation has taken over. `remainingMs`/`startedAtMs` are the
  // elapsed-time bookkeeping that lets a pause stop the clock and a resume
  // pick up from where it left off instead of restarting at full duration.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingMsRef = useRef(autoDismissMs);
  const startedAtMsRef = useRef(0);

  useEffect(() => {
    remainingMsRef.current = autoDismissMs;
    startedAtMsRef.current = Date.now();
    timerRef.current = setTimeout(() => setDismissing(true), autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // Intentionally only [autoDismissMs]: pause()/resume() below manage the
    // same timer without needing this effect to re-run on every render.
  }, [autoDismissMs]);

  useEffect(() => {
    if (!dismissing) return;
    const timer = setTimeout(() => setVisible(false), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dismissing]);

  function pause() {
    if (dismissing || timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    remainingMsRef.current = Math.max(
      remainingMsRef.current - (Date.now() - startedAtMsRef.current),
      0,
    );
  }

  function resume() {
    if (dismissing || timerRef.current !== null) return;
    startedAtMsRef.current = Date.now();
    timerRef.current = setTimeout(() => setDismissing(true), remainingMsRef.current);
  }

  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(1rem+var(--tabbar-h))] z-50 flex justify-center px-4 print:hidden">
      <div
        role="status"
        onMouseEnter={pausable ? pause : undefined}
        onMouseLeave={pausable ? resume : undefined}
        onFocusCapture={pausable ? pause : undefined}
        onBlurCapture={pausable ? resume : undefined}
        className={`${className} rounded-inset border border-border bg-surface shadow-2xl ${
          dismissing ? "toast-dismiss" : "rise-in"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A brief, auto-dismissing acknowledgement for an action that leaves no other
 * trace on screen — the diver record's "Copy link" tap is the first case: the
 * clipboard write already happened, and this is the only place that can say
 * so. Not for anything reversible or that offers a next step (`UndoToast`),
 * and not a substitute for a state a control already carries on its own face
 * (a button's ring/mark, a field's error) — see `docs/design/forms-and-controls.md`.
 *
 * Mount it fresh (`key`) per occurrence — an identical message twice in a row
 * still needs to visibly land twice.
 */
export function Toast({ message, durationMs = 4000 }: { message: string; durationMs?: number }) {
  return (
    <ToastShell autoDismissMs={durationMs} className="px-4 py-3 text-sm font-medium">
      {message}
    </ToastShell>
  );
}
