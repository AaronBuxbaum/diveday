"use client";

import { useEffect, useState } from "react";

// Matches `UndoToast`'s own exit timing — the `.toast-dismiss` keyframe
// duration in globals.css.
const EXIT_DURATION_MS = 200;

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
  const [dismissing, setDismissing] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDismissing(true), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  useEffect(() => {
    if (!dismissing) return;
    const timer = setTimeout(() => setVisible(false), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [dismissing]);

  if (!visible) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(1rem+var(--dock-clearance,0rem))] z-50 flex justify-center px-4 print:hidden">
      <div
        role="status"
        className={`rounded-inset border border-border bg-surface px-4 py-3 text-sm font-medium shadow-2xl ${
          dismissing ? "toast-dismiss" : "rise-in"
        }`}
      >
        {message}
      </div>
    </div>
  );
}
