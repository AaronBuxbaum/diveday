"use client";

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
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  confirmMessage?: string;
  /** For an action the form is not ready for yet; the server still re-checks. */
  disabled?: boolean;
  /** Distinct accessible name when the visible label repeats (e.g. one "Add" per row). */
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();
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
