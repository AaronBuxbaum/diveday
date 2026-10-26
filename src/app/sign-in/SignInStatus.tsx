"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Keep the form's geometry while a retry replaces its previous outcome. */
export function SignInStatus({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <div className={pending ? "invisible" : undefined} aria-hidden={pending || undefined}>
      {children}
    </div>
  );
}
