// i18n-exempt-file: the group label comes from its owning form.
"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Hold only this invoice's submitted values until its action has answered. */
export function InvoicePendingFields({ label, children }: { label?: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <fieldset
      aria-label={label}
      disabled={pending}
      className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0"
    >
      {children}
    </fieldset>
  );
}
