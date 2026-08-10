"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

// Matches the `.toast-dismiss` keyframe duration in globals.css. Kept as a
// timer (not `onAnimationEnd`) because the reduced-motion kill-switch there
// only shortens the animation to ~0ms — it doesn't skip it — and we want one
// unmount path that works identically either way.
const EXIT_DURATION_MS = 200;

/**
 * A land-then-undo toast: the action already happened, and this offers a few
 * seconds to take it back — the delight-first alternative to a blocking
 * "are you sure?" for reversible staff actions (docs delight backlog). It is
 * driven by the redirect that carries the undo target in the URL, auto-dismisses
 * after a beat, and its Undo submits a bound server action. Deliberately generic:
 * pass any inverse action plus the hidden fields it needs.
 *
 * The auto-dismiss countdown pauses while a reader's mouse or keyboard focus
 * is anywhere in the toast (including the Undo button) and resumes counting
 * down from wherever it left off — not a reset to the full duration — once
 * they leave, so tabbing in and out repeatedly can't keep it alive forever.
 */
export function UndoToast({
  message,
  action,
  fields,
  pendingLabel,
  undoLabel,
  // Deliberately clear of Playwright's 8s expect timeout (playwright.config.ts)
  // so any render delay can't make the toast vanish out from under an assertion
  // racing to see it — that collision produced exactly this failure signature.
  autoDismissMs = 12000,
}: {
  message: string;
  action: (formData: FormData) => void;
  fields: Record<string, string>;
  pendingLabel: string;
  undoLabel: string;
  autoDismissMs?: number;
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
    // `--dock-clearance` lifts the toast above the staff phone dock when one
    // is on screen (set by the shop layout's content wrapper); everywhere else
    // the variable is unset and the toast sits at its usual 1rem.
    <div className="fixed inset-x-0 bottom-[calc(1rem+var(--dock-clearance,0rem))] z-50 flex justify-center px-4 print:hidden">
      <div
        role="status"
        onMouseEnter={pause}
        onMouseLeave={resume}
        onFocusCapture={pause}
        onBlurCapture={resume}
        className={`flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-2xl ${
          dismissing ? "toast-dismiss" : "rise-in"
        }`}
      >
        <span className="text-sm font-medium">{message}</span>
        <form action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <SubmitButton
            pendingLabel={pendingLabel}
            className="inline-flex min-h-9 items-center rounded-lg px-2 text-sm font-semibold text-primary underline-offset-2 hover:underline"
          >
            {undoLabel}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
