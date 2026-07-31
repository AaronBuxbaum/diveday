"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A two-tap "Sign out? → Confirm" submit button (UX-persona task 81 — Kai,
 * the day-one hire whose one mis-tap next to Search used to log the whole
 * crew out mid-shift). The first tap only arms the button — it never submits
 * the form — and swaps to the confirm label/style; the second tap on the
 * still-focused button actually submits. No local component in this codebase
 * built a shared inline-confirm before this one (checked); this is scoped to
 * the one call site (`ShopNav`'s sign-out) and small enough to lift into a
 * shared primitive later if another confirm needs the same shape.
 *
 * Deliberately not `window.confirm()` (the pattern `SettingsPage`'s calendar
 * actions use via `SubmitButton`'s `confirmMessage`) — a native dialog is
 * more ceremony than a mis-tap on a boat deserves, per the persona note.
 */
export function InlineConfirmButton({
  idleLabel,
  confirmLabel,
  pendingLabel,
  idleClassName,
  confirmClassName,
  /** Reverts to the idle label if left armed and untouched this long. */
  autoResetMs = 4000,
}: {
  idleLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  idleClassName: string;
  confirmClassName: string;
  autoResetMs?: number;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!armed) return;
    resetTimer.current = setTimeout(() => setArmed(false), autoResetMs);
    return () => clearTimeout(resetTimer.current);
  }, [armed, autoResetMs]);

  return (
    <button
      // Only the confirm tap is a real submit — the arming tap must never
      // fire the form's action, so it stays a plain button until confirmed.
      type={armed ? "submit" : "button"}
      disabled={pending}
      aria-busy={pending}
      className={armed ? confirmClassName : idleClassName}
      onClick={(event) => {
        if (!armed) {
          event.preventDefault();
          setArmed(true);
        }
      }}
      onBlur={() => setArmed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setArmed(false);
      }}
    >
      {pending ? pendingLabel : armed ? confirmLabel : idleLabel}
    </button>
  );
}
