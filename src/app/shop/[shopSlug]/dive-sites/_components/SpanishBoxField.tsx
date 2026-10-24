"use client";

import { AssistFillButton } from "@/components/assists/AssistFillButton";
import { Field, textareaClassFor } from "@/components/ui/form";
import { translationSourceId } from "@/lib/assists/shop-translate";
import { spanishFromName, spanishTextName } from "../spanish-box-names";

export type SpanishBoxCopy = {
  label: string;
  draft: string;
  drafting: string;
  nothing: string;
  stale: string;
};

/**
 * **The Spanish of one of the shop's own fields, as a field of the editor's
 * one form** (visual review 2026-10-24, A11). `TranslationEditor` is the same
 * box with a form and a Save of its own; inside an editor whose one Save
 * writes everything, the box is a field and the editor's action saves it
 * (`spanish-boxes.ts`).
 *
 * The hidden source field carries the digest of the English the Spanish was
 * written from: the stored row's, or a draft's. Typing in the box clears it,
 * since the staffer's own words are theirs to save; a draft's fill does not,
 * because only a trusted (typed) input clears it. Words arrive as props: this
 * is a staff Client Component.
 */
export function SpanishBoxField({
  boxId,
  field,
  defaultValue,
  translatedFrom,
  stale,
  maxLength,
  draft,
  copy,
}: {
  /** The textarea's id; the draft fills it, and its source field, by id. */
  boxId: string;
  /** The translatable field this box holds the Spanish of. */
  field: string;
  defaultValue: string;
  translatedFrom: string;
  stale: boolean;
  maxLength: number;
  /** Absent while assists are dark: the box still takes typed Spanish. */
  draft?: () => Promise<Record<string, string> | null>;
  copy: SpanishBoxCopy;
}) {
  const fromId = translationSourceId(boxId);
  return (
    <div className="flex flex-col gap-2">
      {/* Text, not hidden, so a draft's fill can set it; never shown. */}
      <input
        id={fromId}
        name={spanishFromName(field)}
        type="text"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        defaultValue={translatedFrom}
      />
      <Field label={copy.label} htmlFor={boxId} hint={stale ? copy.stale : undefined}>
        <textarea
          id={boxId}
          name={spanishTextName(field)}
          lang="es"
          rows={3}
          maxLength={maxLength}
          defaultValue={defaultValue}
          className={textareaClassFor(3)}
          onInput={(event) => {
            if (!event.nativeEvent.isTrusted) return;
            const from = document.getElementById(fromId);
            if (from instanceof HTMLInputElement) from.value = "";
          }}
        />
      </Field>
      {draft ? (
        <div>
          <AssistFillButton
            // The draft answers `{ text, translatedFrom }`; this box's fields
            // are named for its subject, so the answer lands on them by id.
            draft={async () => {
              const answer = await draft();
              return answer
                ? {
                    [`#${boxId}`]: answer.text ?? "",
                    [`#${fromId}`]: answer.translatedFrom ?? "",
                  }
                : null;
            }}
            label={copy.draft}
            pendingLabel={copy.drafting}
            emptyLabel={copy.nothing}
          />
        </div>
      ) : null}
    </div>
  );
}
