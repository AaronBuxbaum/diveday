"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, FormStatus, textareaClassFor } from "@/components/ui/form";
import { translationSourceId } from "@/lib/assists/shop-translate";
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
  staleSave: string;
};

/**
 * **The Spanish of one of the shop's own fields** (the `shop-translate`
 * assist). Its own small form beside the original, because the original's
 * form saves the English and nothing else. "Draft in Spanish" fills the box
 * from the saved original; the staffer reads it and saves. Divers reading
 * Spanish see it only while the original is the one it translates, and the
 * box says when that stopped being true.
 *
 * The box carries the digest of the English its Spanish came from (the saved
 * row's, or a draft's), and a save of Spanish written from other English is
 * refused. Typing in the box clears it: the staffer's own words are theirs to
 * save. Only a trusted (typed) input clears it, never a draft's fill.
 */
export function TranslationEditor({
  boxId,
  defaultValue,
  translatedFrom,
  stale,
  maxLength,
  rows = 3,
  save,
  draft,
  copy,
}: {
  boxId: string;
  defaultValue: string;
  /** The digest of the English `defaultValue` translates, or "" for none. */
  translatedFrom: string;
  stale: boolean;
  maxLength: number;
  rows?: 2 | 3 | 4;
  save: (
    prev: { status?: "saved" | "error" | "stale" },
    formData: FormData,
  ) => Promise<{ status?: "saved" | "error" | "stale" }>;
  /** Absent while assists are dark: the box still takes typed Spanish. */
  draft?: () => Promise<Record<string, string> | null>;
  copy: TranslationEditorCopy;
}) {
  const [state, action] = useActionState(save, {});
  const fromId = translationSourceId(boxId);
  return (
    <form action={action} className="flex flex-col gap-2">
      {/* Text, not hidden, so a draft's fill can set it; never shown. */}
      <input
        id={fromId}
        name="translatedFrom"
        type="text"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        defaultValue={translatedFrom}
      />
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
          onInput={(event) => {
            if (!event.nativeEvent.isTrusted) return;
            const from = document.getElementById(fromId);
            if (from instanceof HTMLInputElement) from.value = "";
          }}
        />
      </Field>
      <FieldActions>
        {draft ? (
          <AssistFillButton draft={draft} label={copy.draft} pendingLabel={copy.drafting} />
        ) : null}
        <SubmitButton pendingLabel={copy.saving} className={buttonClass({ variant: "secondary" })}>
          {copy.save}
        </SubmitButton>
        <FormStatus tone={state.status === "saved" ? "success" : "danger"}>
          {state.status === "saved"
            ? copy.saved
            : state.status === "stale"
              ? copy.staleSave
              : state.status === "error"
                ? copy.error
                : undefined}
        </FormStatus>
      </FieldActions>
    </form>
  );
}
