"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, FormStatus, textareaClassFor } from "@/components/ui/form";
import { AssistFillButton } from "./AssistFillButton";

export type TranslationEditorCopy = {
  label: string;
  draft: string;
  drafting: string;
  save: string;
  saving: string;
  saved: string;
  error: string;
  stale: string;
};

/**
 * **The Spanish of one of the shop's own fields** (the `shop-translate`
 * assist). Its own small form beside the original, because the original's
 * form saves the English and nothing else. "Draft in Spanish" fills the box
 * from the saved original; the staffer reads it and saves. Divers reading
 * Spanish see it only while the original is the one it translates, and the
 * box says when that stopped being true.
 */
export function TranslationEditor({
  boxId,
  defaultValue,
  stale,
  maxLength,
  rows = 3,
  save,
  draft,
  copy,
}: {
  boxId: string;
  defaultValue: string;
  stale: boolean;
  maxLength: number;
  rows?: 2 | 3 | 4;
  save: (
    prev: { status?: "saved" | "error" },
    formData: FormData,
  ) => Promise<{ status?: "saved" | "error" }>;
  /** Absent while assists are dark: the box still takes typed Spanish. */
  draft?: () => Promise<Record<string, string> | null>;
  copy: TranslationEditorCopy;
}) {
  const [state, action] = useActionState(save, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <Field
        label={copy.label}
        htmlFor={boxId}
        hint={stale && !state.status ? copy.stale : undefined}
      >
        <textarea
          id={boxId}
          name="text"
          lang="es"
          rows={rows}
          maxLength={maxLength}
          defaultValue={defaultValue}
          className={textareaClassFor(rows)}
        />
      </Field>
      <FieldActions>
        {draft ? (
          <AssistFillButton draft={draft} label={copy.draft} pendingLabel={copy.drafting} />
        ) : null}
        <SubmitButton pendingLabel={copy.saving} className={buttonClass({ variant: "secondary" })}>
          {copy.save}
        </SubmitButton>
        <FormStatus tone={state.status === "error" ? "danger" : "success"}>
          {state.status === "saved"
            ? copy.saved
            : state.status === "error"
              ? copy.error
              : undefined}
        </FormStatus>
      </FieldActions>
    </form>
  );
}
