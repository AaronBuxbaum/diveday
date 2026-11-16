"use client";

import { unstable_rethrow } from "next/navigation";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";

/** Manual submission keeps every draft on refusal; only successful creation resets the form. */
export function ClassroomActivityForm({
  action,
  attemptId,
  label,
  pendingLabel,
  retryLabel,
  children,
  resetOnSuccess = false,
  danger = false,
}: {
  action: (previous: { error?: string }, form: FormData) => Promise<{ error?: string }>;
  attemptId: string;
  label: string;
  pendingLabel: string;
  retryLabel: string;
  children: ReactNode;
  resetOnSuccess?: boolean;
  danger?: boolean;
}) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const attempt = useRef(attemptId);
  return (
    <form
      className="mt-3 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        data.set("attemptId", attempt.current);
        setError(undefined);
        start(async () => {
          try {
            const result = await action({}, data);
            setError(result.error);
            if (!result.error) {
              attempt.current = crypto.randomUUID();
              if (resetOnSuccess) form.reset();
            }
          } catch (error) {
            unstable_rethrow(error);
            // The request may have committed. Keep both draft and durable attempt for a safe retry.
            setError(retryLabel);
          }
        });
      }}
    >
      {children}
      {error ? <FormStatus tone="danger">{error}</FormStatus> : null}
      <div>
        <button
          type="submit"
          disabled={pending}
          aria-disabled={pending}
          className={buttonClass({ variant: danger ? "danger" : "secondary" })}
        >
          {pending ? pendingLabel : label}
        </button>
      </div>
    </form>
  );
}
