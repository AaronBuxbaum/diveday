"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FormStatus } from "@/components/ui/form";
import type { BookkeeperFormState } from "../bookkeeper-actions";

export type BookkeeperFormCopy = {
  label: string;
  description: string;
  save: string;
  saving: string;
  saved: string;
  cleared: string;
  invalid: string;
  confirmationSent: string;
  confirmationNotSent: string;
};

/** The standing line under the field: who set it, when, and whether it is live. */
export type BookkeeperStatus = { tone: "muted" | "warning"; text: string };

/**
 * **"Bookkeeper's email"** (fifth loop, item 35): one address, saved in
 * place; empty turns the month-end email off. The answer to a save sits under
 * the field, where the eye already is.
 */
export function BookkeeperForm({
  action,
  current,
  status,
  copy,
}: {
  action: (state: BookkeeperFormState, formData: FormData) => Promise<BookkeeperFormState>;
  current: string | null;
  status: BookkeeperStatus | null;
  copy: BookkeeperFormCopy;
}) {
  const idle: BookkeeperFormState = { status: "idle" };
  const [state, formAction] = useActionState(action, idle);
  const answer =
    state.status === "saved"
      ? { tone: "success" as const, text: copy.saved }
      : state.status === "cleared"
        ? { tone: "success" as const, text: copy.cleared }
        : state.status === "invalid"
          ? { tone: "danger" as const, text: copy.invalid }
          : state.status === "confirmation-sent"
            ? { tone: "success" as const, text: copy.confirmationSent }
            : state.status === "confirmation-not-sent"
              ? { tone: "warning" as const, text: copy.confirmationNotSent }
              : null;
  return (
    <form action={formAction} className="flex max-w-xl flex-wrap items-end gap-3">
      <Field label={copy.label} description={copy.description} className="min-w-0 flex-1">
        <input
          type="email"
          name="email"
          autoComplete="off"
          defaultValue={current ?? ""}
          className={controlClass}
        />
      </Field>
      <SubmitButton pendingLabel={copy.saving} className={buttonClass({ variant: "secondary" })}>
        {copy.save}
      </SubmitButton>
      {answer ? (
        <FormStatus tone={answer.tone} className="basis-full">
          {answer.text}
        </FormStatus>
      ) : status ? (
        <p
          className={`basis-full text-sm ${status.tone === "warning" ? "text-warning-strong" : "text-muted"}`}
        >
          {status.text}
        </p>
      ) : null}
    </form>
  );
}
