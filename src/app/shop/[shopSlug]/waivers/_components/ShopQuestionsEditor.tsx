"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import {
  newShopQuestionId,
  promptHealthWord,
  SHOP_CHOICE_OPTION_MAX,
  SHOP_CHOICE_OPTIONS_MAX,
  SHOP_CHOICE_OPTIONS_MIN,
  SHOP_QUESTION_KINDS,
  SHOP_QUESTION_PROMPT_MAX,
  SHOP_QUESTIONS_MAX,
  type ShopQuestion,
  type ShopQuestionKind,
} from "@/lib/waiver-questions";

/**
 * Every word the editor renders, composed on the server: a staff Client
 * Component never translates for itself.
 */
export type ShopQuestionsCopy = {
  heading: string;
  intro: string;
  alreadyAsked: string;
  optionalAdvice: string;
  empty: string;
  add: string;
  full: string;
  promptLabel: string;
  kindLabel: string;
  kinds: Record<ShopQuestionKind, string>;
  requiredLabel: string;
  optionsLabel: string;
  optionsHint: string;
  optionsCount: string;
  moveUp: string;
  moveDown: string;
  delete: string;
  /** The non-blocking line beside a prompt that names a health word. */
  healthWarning: string;
  /** "Question {number}", already a template with `{number}` to fill. */
  questionLabel: string;
};

/** One row as the editor holds it: the options as typed, one per line. */
type DraftQuestion = {
  id: string;
  kind: ShopQuestionKind;
  prompt: string;
  required: boolean;
  optionsText: string;
};

function optionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** What the hidden field posts: the list as `parseShopQuestions` reads it. */
function serialise(rows: readonly DraftQuestion[]): string {
  return JSON.stringify(
    rows.map(
      (row): ShopQuestion => ({
        id: row.id,
        kind: row.kind,
        prompt: row.prompt,
        required: row.required,
        ...(row.kind === "choice" ? { options: optionLines(row.optionsText) } : {}),
      }),
    ),
  );
}

/**
 * **"Your questions"** (glossary *Shop question*): the shop's own questions,
 * under the release text and published with it by the one Publish. Add, move
 * up or down, Delete; the list is part of the version, so a deleted question
 * stays on every record already signed with it.
 *
 * Words are never refused here or on the server. A prompt that names a health
 * word gets one quiet warning beside it, because health questions belong to
 * the standard questionnaire, which refers a diver to a doctor, and an answer
 * here is never checked (dive-domain review, point 2). Everything this posts
 * is re-validated by `saveWaiverAction` through `parseShopQuestions`.
 */
export function ShopQuestionsEditor({
  initialQuestions,
  healthWords,
  copy,
}: {
  initialQuestions: readonly ShopQuestion[];
  healthWords: readonly string[];
  copy: ShopQuestionsCopy;
}) {
  const [rows, setRows] = useState<DraftQuestion[]>(() =>
    initialQuestions.map((question) => ({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      required: question.required,
      optionsText: (question.options ?? []).join("\n"),
    })),
  );

  function update(id: string, patch: Partial<DraftQuestion>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function move(index: number, by: -1 | 1) {
    setRows((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (row) next.splice(target, 0, row);
      return next;
    });
  }

  function add() {
    setRows((current) =>
      current.length >= SHOP_QUESTIONS_MAX
        ? current
        : [
            ...current,
            {
              id: newShopQuestionId(),
              kind: "yes_no",
              prompt: "",
              required: false,
              optionsText: "",
            },
          ],
    );
  }

  return (
    <section aria-labelledby="shop-questions-heading" className="flex flex-col gap-4">
      <div>
        <h3 id="shop-questions-heading" className="text-base font-semibold">
          {copy.heading}
        </h3>
        <p className="mt-1 text-sm text-muted">{copy.intro}</p>
        <p className="mt-1 text-sm text-muted">{copy.alreadyAsked}</p>
        <p className="mt-1 text-sm text-muted">{copy.optionalAdvice}</p>
      </div>
      <input type="hidden" name="questions" value={serialise(rows)} />
      {rows.length === 0 ? <p className="text-sm text-muted">{copy.empty}</p> : null}
      <ol className="flex flex-col gap-4">
        {rows.map((row, index) => {
          const healthWord = promptHealthWord(row.prompt, healthWords);
          const options = optionLines(row.optionsText);
          const optionsOutOfRange =
            row.kind === "choice" &&
            (options.length < SHOP_CHOICE_OPTIONS_MIN || options.length > SHOP_CHOICE_OPTIONS_MAX);
          return (
            <li
              key={row.id}
              data-shop-question={row.id}
              aria-label={copy.questionLabel.replace("{number}", String(index + 1))}
              className="rounded-lg border border-border p-4"
            >
              <FieldGrid columns={1} className="gap-y-4">
                <Field
                  label={copy.promptLabel}
                  description={
                    healthWord ? (
                      <span className="text-warning-strong" data-health-warning="">
                        {copy.healthWarning}
                      </span>
                    ) : undefined
                  }
                >
                  <input
                    required
                    maxLength={SHOP_QUESTION_PROMPT_MAX}
                    value={row.prompt}
                    onChange={(event) => update(row.id, { prompt: event.target.value })}
                    className={controlClass}
                  />
                </Field>
                <Field label={copy.kindLabel}>
                  <select
                    value={row.kind}
                    onChange={(event) =>
                      update(row.id, { kind: event.target.value as ShopQuestionKind })
                    }
                    className={controlClass}
                  >
                    {SHOP_QUESTION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {copy.kinds[kind]}
                      </option>
                    ))}
                  </select>
                </Field>
                {row.kind === "choice" ? (
                  <Field
                    label={copy.optionsLabel}
                    description={optionsOutOfRange ? copy.optionsCount : copy.optionsHint}
                  >
                    <textarea
                      required
                      rows={4}
                      value={row.optionsText}
                      onChange={(event) => update(row.id, { optionsText: event.target.value })}
                      maxLength={(SHOP_CHOICE_OPTION_MAX + 1) * SHOP_CHOICE_OPTIONS_MAX}
                      className={textareaClassFor(4)}
                    />
                  </Field>
                ) : null}
              </FieldGrid>
              <ChoiceRow
                type="checkbox"
                checked={row.required}
                onChange={(event) => update(row.id, { required: event.target.checked })}
                className="mt-3 text-sm"
              >
                {copy.requiredLabel}
              </ChoiceRow>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {copy.moveUp}
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === rows.length - 1}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {copy.moveDown}
                </button>
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                  className={buttonClass({ variant: "danger-ghost", size: "sm" })}
                >
                  {copy.delete}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= SHOP_QUESTIONS_MAX}
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.add}
        </button>
        {rows.length >= SHOP_QUESTIONS_MAX ? (
          <p className="mt-2 text-sm text-muted">{copy.full}</p>
        ) : null}
      </div>
    </section>
  );
}
