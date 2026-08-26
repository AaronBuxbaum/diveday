"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with an in-flight state: disabled while the server action
 * runs, label swapped, no layout shift. Prevents double submission.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  confirmMessage,
  disabled = false,
  ariaLabel,
  observabilityAction,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  confirmMessage?: string;
  /** For an action the form is not ready for yet; the server still re-checks. */
  disabled?: boolean;
  /** Distinct accessible name when the visible label repeats (e.g. one "Add" per row). */
  ariaLabel?: string;
  /** Stable, non-identifying action label for client mutation timing. */
  observabilityAction?: string;
}) {
  const { pending } = useFormStatus();
  const startedAt = useRef<number | null>(null);
  const sawPending = useRef(false);

  useEffect(() => {
    if (pending) {
      sawPending.current = true;
      if (startedAt.current === null) startedAt.current = performance.now();
      return;
    }
    if (!sawPending.current || startedAt.current === null) return;
    const durationMs = Math.max(0, performance.now() - startedAt.current);
    startedAt.current = null;
    sawPending.current = false;
    if (typeof window === "undefined") return;
    const action = observabilityAction ?? "submit";
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(action)) return;
    window.dispatchEvent(
      new CustomEvent("diveday:mutation-settled", { detail: { action, durationMs } }),
    );
  }, [observabilityAction, pending]);

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={className}
      aria-label={ariaLabel}
      aria-busy={pending}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
