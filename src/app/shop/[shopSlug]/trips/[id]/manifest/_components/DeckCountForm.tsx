"use client";

import { useActionState, useId } from "react";
import { ErrorToast } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { DeckCountResult } from "../actions";

export type DeckCountAction = (
  prev: DeckCountResult,
  formData: FormData,
) => Promise<DeckCountResult>;

export type DeckCountCopy = {
  label: string;
  save: string;
  saving: string;
  invalid: string;
  error: string;
};

/**
 * **The count on deck** (issue #4248): one number box and one save, for the
 * heads the captain counted at this checkpoint. Saving records it and the
 * manifest compares; nothing here gates the roll call.
 */
export function DeckCountForm({
  action,
  counted,
  max,
  copy,
}: {
  action: DeckCountAction;
  /** The newest count at this checkpoint, prefilled so a recount starts from it. */
  counted: number | null;
  /** The largest count the server takes (`DECK_COUNT_MAX`). */
  max: number;
  copy: DeckCountCopy;
}) {
  const [result, formAction, isPending] = useActionState(action, null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const invalid = result !== null && !result.ok && result.reason === "invalid";
  return (
    <form action={formAction} className="flex flex-col gap-2 px-4 py-3">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {copy.label}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={fieldId}
          name="counted"
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          required
          defaultValue={counted ?? ""}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className={`${controlClass} w-28 tabular-nums`}
        />
        <button
          type="submit"
          disabled={isPending}
          aria-busy={isPending}
          className={buttonClass({ variant: "secondary", className: "min-h-11" })}
        >
          {isPending ? copy.saving : copy.save}
        </button>
      </div>
      {invalid ? (
        <p id={errorId} className="text-sm text-danger">
          {copy.invalid}
        </p>
      ) : null}
      {result && !result.ok && result.reason === "error" ? (
        <ErrorToast message={copy.error} />
      ) : null}
    </form>
  );
}
