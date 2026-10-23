"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow, controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import {
  newShopQuestionId,
  promptHealthWord,
  SHOP_CHOICE_OPTION_MAX,
  SHOP_CHOICE_OPTIONS_MAX,
  SHOP_QUESTION_KINDS,
  SHOP_QUESTION_PROMPT_MAX,
  SHOP_QUESTIONS_MAX,
  type ShopQuestion,
  type ShopQuestionKind,
  type ShopQuestionsRefusal,
  shopQuestionProblem,
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
  moveUp: string;
  moveDown: string;
  delete: string;
  /** The non-blocking line beside a prompt that names a health word. */
  healthWarning: string;
  /** "Question {number}", already a template with `{number}` to fill. */
  questionLabel: string;
  /**
   * What is wrong with one question, by the rule the server refuses on
   * (`shopQuestionProblem`), shown under the control it is about.
   */
  problems: {
    promptEmpty: string;
    promptTooLong: string;
    optionsCount: string;
    optionTooLong: string;
    duplicateOption: string;
    controlCharacter: string;
  };
};

/** The words for a problem, and whether it belongs under the options rather than the prompt. */
function problemText(
  problem: ShopQuestionsRefusal,
  problems: ShopQuestionsCopy["problems"],
): { text: string; onOptions: boolean } {
  switch (problem) {
    case "prompt_empty":
      return { text: problems.promptEmpty, onOptions: false };
    case "prompt_too_long":
      return { text: problems.promptTooLong, onOptions: false };
    case "option_too_long":
      return { text: problems.optionTooLong, onOptions: true };
    case "duplicate_option":
      return { text: problems.duplicateOption, onOptions: true };
    case "control_character":
      return { text: problems.controlCharacter, onOptions: false };
    default:
      return { text: problems.optionsCount, onOptions: true };
  }
}

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

/** The rows as the list `parseShopQuestions` reads. */
function asQuestions(rows: readonly DraftQuestion[]): ShopQuestion[] {
  return rows.map(
    (row): ShopQuestion => ({
      id: row.id,
      kind: row.kind,
      prompt: row.prompt,
      required: row.required,
      ...(row.kind === "choice" ? { options: optionLines(row.optionsText) } : {}),
    }),
  );
}

/**
 * The health word a question names, in its prompt or in any of a choice's
 * options (dive-domain review 1, S3): a list of "Asthma / Heart condition /
 * None" under "Anything we should know?" is the same buried disclosure.
 */
function questionHealthWord(row: DraftQuestion, words: readonly string[]): string | null {
  const texts = [row.prompt, ...(row.kind === "choice" ? optionLines(row.optionsText) : [])];
  for (const text of texts) {
    const word = promptHealthWord(text, words);
    if (word) return word;
  }
  return null;
}

/**
 * A control that tells the browser it is invalid, so the form's own gate stops
 * Publish before anything is lost (dive-domain review 2, S2). The message is
 * the same words shown under the control.
 */
function useValidity<T extends HTMLInputElement | HTMLTextAreaElement>(message: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(message);
  }, [message]);
  return ref;
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
  refusedNumber,
  onChange,
}: {
  initialQuestions: readonly ShopQuestion[];
  healthWords: readonly string[];
  copy: ShopQuestionsCopy;
  /** The question (1-based) a refused publish named: its problem shows at once. */
  refusedNumber?: number;
  /** The list as it stands after each edit, for the publish choice's wording. */
  onChange?: (questions: ShopQuestion[]) => void;
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

  // A problem shows once its question has been edited or a publish was tried:
  // a fresh, empty question is not yet a mistake.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => {
    const refused = refusedNumber === undefined ? undefined : initialQuestions[refusedNumber - 1];
    return new Set(refused ? [refused.id] : []);
  });
  const touch = (id: string) =>
    setTouched((current) => (current.has(id) ? current : new Set(current).add(id)));

  const questions = asQuestions(rows);
  const serialised = JSON.stringify(questions);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `serialised` is the list's identity; the callback is read through a ref.
  useEffect(() => {
    onChangeRef.current?.(questions);
  }, [serialised]);

  function update(id: string, patch: Partial<DraftQuestion>) {
    touch(id);
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
      <input type="hidden" name="questions" value={serialised} />
      {rows.length === 0 ? <p className="text-sm text-muted">{copy.empty}</p> : null}
      <ol className="flex flex-col gap-4">
        {rows.map((row, index) => (
          <QuestionRow
            key={row.id}
            row={row}
            index={index}
            last={index === rows.length - 1}
            healthWord={questionHealthWord(row, healthWords)}
            problem={shopQuestionProblem({
              kind: row.kind,
              prompt: row.prompt,
              options: row.kind === "choice" ? optionLines(row.optionsText) : undefined,
            })}
            showProblem={touched.has(row.id)}
            copy={copy}
            onUpdate={(patch) => update(row.id, patch)}
            onInvalid={() => touch(row.id)}
            onMove={(by) => move(index, by)}
            onDelete={() => setRows((current) => current.filter((item) => item.id !== row.id))}
          />
        ))}
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

function QuestionRow({
  row,
  index,
  last,
  healthWord,
  problem,
  showProblem,
  copy,
  onUpdate,
  onInvalid,
  onMove,
  onDelete,
}: {
  row: DraftQuestion;
  index: number;
  last: boolean;
  healthWord: string | null;
  problem: ShopQuestionsRefusal | null;
  showProblem: boolean;
  copy: ShopQuestionsCopy;
  onUpdate: (patch: Partial<DraftQuestion>) => void;
  onInvalid: () => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const named = problem ? problemText(problem, copy.problems) : null;
  const promptMessage = named && !named.onOptions ? named.text : "";
  const optionsMessage = named?.onOptions ? named.text : "";
  const promptRef = useValidity<HTMLInputElement>(promptMessage);
  const optionsRef = useValidity<HTMLTextAreaElement>(optionsMessage);
  return (
    <li
      data-shop-question={row.id}
      aria-label={copy.questionLabel.replace("{number}", String(index + 1))}
      className="rounded-lg border border-border p-4"
    >
      <FieldGrid columns={1} className="gap-y-4">
        <Field
          label={copy.promptLabel}
          error={showProblem && promptMessage ? promptMessage : undefined}
          description={
            healthWord ? (
              <span className="text-warning-strong" data-health-warning="">
                {copy.healthWarning}
              </span>
            ) : undefined
          }
        >
          <input
            ref={promptRef}
            required
            maxLength={SHOP_QUESTION_PROMPT_MAX}
            value={row.prompt}
            onChange={(event) => onUpdate({ prompt: event.target.value })}
            onInvalid={onInvalid}
            className={controlClass}
          />
        </Field>
        <Field label={copy.kindLabel}>
          <select
            value={row.kind}
            onChange={(event) => onUpdate({ kind: event.target.value as ShopQuestionKind })}
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
            description={copy.optionsHint}
            error={showProblem && optionsMessage ? optionsMessage : undefined}
          >
            <textarea
              ref={optionsRef}
              required
              rows={4}
              value={row.optionsText}
              onChange={(event) => onUpdate({ optionsText: event.target.value })}
              onInvalid={onInvalid}
              maxLength={(SHOP_CHOICE_OPTION_MAX + 1) * SHOP_CHOICE_OPTIONS_MAX}
              className={textareaClassFor(4)}
            />
          </Field>
        ) : null}
      </FieldGrid>
      <ChoiceRow
        type="checkbox"
        checked={row.required}
        onChange={(event) => onUpdate({ required: event.target.checked })}
        className="mt-3 text-sm"
      >
        {copy.requiredLabel}
      </ChoiceRow>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.moveUp}
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={last}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.moveDown}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={buttonClass({ variant: "danger-ghost", size: "sm" })}
        >
          {copy.delete}
        </button>
      </div>
    </li>
  );
}
