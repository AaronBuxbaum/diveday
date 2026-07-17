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
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
