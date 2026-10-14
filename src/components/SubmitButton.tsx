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
  formAction,
  formNoValidate,
  name,
  value,
}: {
  children: React.ReactNode;
  /** Usually words; a drawn mark where the control is an icon, so the pending state keeps its drawing. */
  pendingLabel: React.ReactNode;
  className?: string;
  confirmMessage?: string;
  /** For an action the form is not ready for yet; the server still re-checks. */
  disabled?: boolean;
  /** Distinct accessible name when the visible label repeats (e.g. one "Add" per row). */
  ariaLabel?: string;
  /** Stable, non-identifying action label for client mutation timing. */
  observabilityAction?: string;
  /**
   * Posts the form to this action instead of the form's own — a row's Delete
   * living in its edit form beside Save. The button's in-flight state then
   * follows this action alone, so a Save and a Delete sharing one form never
   * both read as pending; a Save beside such a Delete passes its own action
   * here for the same reason.
   */
  formAction?: (formData: FormData) => void | Promise<void>;
  /** Skips the form's validation: an act the form's own fields do not gate. */
  formNoValidate?: boolean;
  /**
   * The submitter's own field, for a form with several answers (returned, discarded, reopen).
   * Every one of them is disabled while the form posts, so no second answer goes after the
   * first; only the one pressed wears its pending label and `aria-busy`.
   */
  name?: string;
  value?: string;
}) {
  const status = useFormStatus();
  const pending = status.pending && (formAction === undefined || status.action === formAction);
  const pressed = pending && (name === undefined || status.data?.get(name) === value);
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
      formAction={formAction}
      formNoValidate={formNoValidate}
      name={name}
      value={value}
      disabled={pending || disabled}
      className={className}
      aria-label={ariaLabel}
      aria-busy={pressed}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pressed ? pendingLabel : children}
    </button>
  );
}
