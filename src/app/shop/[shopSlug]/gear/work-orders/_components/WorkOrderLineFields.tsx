// i18n-exempt-file: the group label arrives translated from the owning form.
"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submitted figures stay fixed until the action has answered and restored its fields. */
export function WorkOrderLineFields({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <fieldset aria-label={label} disabled={pending} className={`min-w-0 ${className}`}>
      {children}
    </fieldset>
  );
}
