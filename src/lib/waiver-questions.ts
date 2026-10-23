import { isValidCalendarDate } from "./calendar-date";

/**
 * **Shop questions on the waiver** (glossary *Shop question*): a shop's own
 * questions, asked after the standard medical questionnaire, answered on the
 * same page, and sealed into the signed record as a snapshot.
 *
 * They **inform and never gate**. Nothing in this module, and nothing that
 * reads its output, may change a record's status, its medical review, a
 * diver's readiness, admission, or any manifest flag. `required` means
 * *answered*, never a particular answer: no kind can require "yes", so a diver
 * who honestly answers "no" to "I confirm I am medically fit to dive" still
 * signs, and the standard questionnaire's referral path is what handles them
 * (dive-domain review B1).
 *
 * Framework-free and pure: the editor's save, the diver's submit, the draft
 * restore and the health-word warning all decide here.
 */

export const SHOP_QUESTION_KINDS = ["yes_no", "text", "number", "date", "choice"] as const;
export type ShopQuestionKind = (typeof SHOP_QUESTION_KINDS)[number];

/** One question on one template version. Ids are stable across versions. */
export type ShopQuestion = {
  id: string;
  kind: ShopQuestionKind;
  prompt: string;
  required: boolean;
  /** `choice` only: 2 to 8 options, each at most 80 characters. */
  options?: string[];
};

/** What a diver can answer: yes/no, a string (text, date, choice) or a whole number. */
export type ShopAnswerValue = string | boolean | number;

/**
 * One question **as it was asked**, with its answer, inside the signed record.
 * Built by the server from the record's own template row, never from anything
 * a client sent. `answer` is null for an optional question left blank.
 */
export type ShopAnswer = ShopQuestion & { answer: ShopAnswerValue | null };

/** "Save and finish later": typed values by question id, re-validated on load. */
export type DraftShopAnswers = Record<string, ShopAnswerValue>;

export const SHOP_QUESTIONS_MAX = 15;
export const SHOP_QUESTION_PROMPT_MAX = 200;
export const SHOP_ANSWER_TEXT_MAX = 500;
export const SHOP_ANSWER_NUMBER_MAX = 100_000;
export const SHOP_CHOICE_OPTIONS_MIN = 2;
export const SHOP_CHOICE_OPTIONS_MAX = 8;
export const SHOP_CHOICE_OPTION_MAX = 80;

/** An id the editor mints: lowercase letters and digits, 8 to 32 of them. */
const SHOP_QUESTION_ID = /^[a-z0-9]{8,32}$/;

/** The form field a question's answer posts under. Distinct from the medical form's `q_`. */
export const SHOP_ANSWER_FIELD_PREFIX = "sq_";

export function shopAnswerField(questionId: string): string {
  return `${SHOP_ANSWER_FIELD_PREFIX}${questionId}`;
}

export function isShopQuestionKind(value: unknown): value is ShopQuestionKind {
  return typeof value === "string" && (SHOP_QUESTION_KINDS as readonly string[]).includes(value);
}

export function isShopQuestionId(value: unknown): value is string {
  return typeof value === "string" && SHOP_QUESTION_ID.test(value);
}

/** A fresh id for a question the editor just added. */
export function newShopQuestionId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * The same normalisation the release body gets (#720): newlines, Unicode form
 * and the ends. A prompt pasted back from Word compares equal to itself, so an
 * unchanged list is never a new version.
 */
export function normalizeShopText(value: string): string {
  return value.replace(/\r\n?/g, "\n").normalize("NFC").trim();
}

export type ShopQuestionsRefusal =
  | "malformed"
  | "too_many"
  | "bad_id"
  | "duplicate_id"
  | "bad_kind"
  | "prompt_empty"
  | "prompt_too_long"
  | "options_count"
  | "option_empty"
  | "option_too_long"
  | "duplicate_option";

/**
 * The editor's list, as the server accepts it: an array of at most 15
 * questions, each with a well-formed id no other question on the list has, a
 * known kind, a prompt of 1 to 200 characters, and (for `choice` alone) 2 to 8
 * distinct options. Returned normalised, with no key a kind does not use, so
 * the stored list and its comparison are one spelling.
 *
 * Never refuses a prompt for its words: a health word earns a warning in the
 * editor ({@link promptHealthWord}), never a refusal.
 */
export function parseShopQuestions(
  raw: unknown,
):
  | { ok: true; questions: ShopQuestion[] }
  | { ok: false; reason: ShopQuestionsRefusal; index?: number } {
  if (!Array.isArray(raw)) return { ok: false, reason: "malformed" };
  if (raw.length > SHOP_QUESTIONS_MAX) return { ok: false, reason: "too_many" };
  const seen = new Set<string>();
  const questions: ShopQuestion[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "malformed", index };
    }
    const item = entry as Record<string, unknown>;
    if (!isShopQuestionId(item.id)) return { ok: false, reason: "bad_id", index };
    if (seen.has(item.id)) return { ok: false, reason: "duplicate_id", index };
    seen.add(item.id);
    if (!isShopQuestionKind(item.kind)) return { ok: false, reason: "bad_kind", index };
    if (typeof item.prompt !== "string") return { ok: false, reason: "malformed", index };
    const prompt = normalizeShopText(item.prompt).replace(/\s*\n\s*/g, " ");
    if (prompt === "") return { ok: false, reason: "prompt_empty", index };
    if (prompt.length > SHOP_QUESTION_PROMPT_MAX) {
      return { ok: false, reason: "prompt_too_long", index };
    }
    if (typeof item.required !== "boolean") return { ok: false, reason: "malformed", index };
    const question: ShopQuestion = {
      id: item.id,
      kind: item.kind,
      prompt,
      required: item.required,
    };
    if (item.kind === "choice") {
      if (!Array.isArray(item.options)) return { ok: false, reason: "options_count", index };
      const options: string[] = [];
      for (const option of item.options) {
        if (typeof option !== "string") return { ok: false, reason: "malformed", index };
        const text = normalizeShopText(option);
        if (text === "") return { ok: false, reason: "option_empty", index };
        if (text.length > SHOP_CHOICE_OPTION_MAX) {
          return { ok: false, reason: "option_too_long", index };
        }
        if (options.includes(text)) return { ok: false, reason: "duplicate_option", index };
        options.push(text);
      }
      if (options.length < SHOP_CHOICE_OPTIONS_MIN || options.length > SHOP_CHOICE_OPTIONS_MAX) {
        return { ok: false, reason: "options_count", index };
      }
      question.options = options;
    }
    questions.push(question);
  }
  return { ok: true, questions };
}

/** One canonical spelling of a question, key order fixed, for comparison. */
function canonicalQuestion(question: ShopQuestion): string {
  return JSON.stringify([
    question.id,
    question.kind,
    normalizeShopText(question.prompt),
    question.required,
    question.kind === "choice" ? (question.options ?? []).map(normalizeShopText) : null,
  ]);
}

/**
 * Whether two lists are the same questions: ids, order, kinds, prompts,
 * options and `required`, compared deep and after normalisation. Equal lists
 * with an equal body and title are not a new version (#720); anything else is,
 * through the publisher's own materiality choice (never inferred here).
 */
export function shopQuestionsEqual(
  a: readonly ShopQuestion[],
  b: readonly ShopQuestion[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((question, index) => {
    const other = b[index];
    return other !== undefined && canonicalQuestion(question) === canonicalQuestion(other);
  });
}

/**
 * One raw form value read as an answer to one question: the typed value,
 * `null` for blank, or `invalid` for a value the kind cannot hold. A `choice`
 * answer must be one of the question's own options, spelled exactly.
 */
export function readShopAnswer(
  question: ShopQuestion,
  raw: string | null | undefined,
): ShopAnswerValue | null | "invalid" {
  const value = normalizeShopText(raw ?? "");
  if (value === "") return null;
  switch (question.kind) {
    case "yes_no":
      return value === "yes" ? true : value === "no" ? false : "invalid";
    case "text":
      return value.length <= SHOP_ANSWER_TEXT_MAX ? value : "invalid";
    case "number": {
      if (!/^\d{1,6}$/.test(value)) return "invalid";
      const number = Number.parseInt(value, 10);
      return number <= SHOP_ANSWER_NUMBER_MAX ? number : "invalid";
    }
    case "date":
      return isValidCalendarDate(value) ? value : "invalid";
    case "choice":
      return (question.options ?? []).includes(value) ? value : "invalid";
  }
}

/** Whether a typed value is one the question could hold: the draft's re-check. */
function holdsShopAnswer(question: ShopQuestion, value: unknown): value is ShopAnswerValue {
  switch (question.kind) {
    case "yes_no":
      return typeof value === "boolean";
    case "text":
      return typeof value === "string" && value !== "" && value.length <= SHOP_ANSWER_TEXT_MAX;
    case "number":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= SHOP_ANSWER_NUMBER_MAX
      );
    case "date":
      return typeof value === "string" && isValidCalendarDate(value);
    case "choice":
      return typeof value === "string" && (question.options ?? []).includes(value);
  }
}

export type ShopAnswersOutcome =
  | {
      ok: true;
      /**
       * Every question as asked, with its answer. **Null when the template has
       * no questions, never `[]`**, and never null when it has any: a record
       * whose template asked something and whose snapshot is missing must not
       * verify as whole (dive-domain review C1).
       */
      snapshot: ShopAnswer[] | null;
    }
  | {
      ok: false;
      /** The first question, in the shop's order, whose answer is refused. */
      questionId: string;
      reason: "required" | "invalid";
    };

/**
 * The diver's answers checked against the questions the record's own template
 * version asked, and the snapshot that seals them. Answers are read by id from
 * `read`; prompts, kinds and options come only from `questions`, so a client
 * that posts its own wording changes nothing that is sealed (B1).
 *
 * `required` is answered, never a particular answer.
 */
export function buildShopAnswers(
  questions: readonly ShopQuestion[],
  read: (questionId: string) => string | null | undefined,
): ShopAnswersOutcome {
  if (questions.length === 0) return { ok: true, snapshot: null };
  const snapshot: ShopAnswer[] = [];
  for (const question of questions) {
    const answer = readShopAnswer(question, read(question.id));
    if (answer === "invalid") return { ok: false, questionId: question.id, reason: "invalid" };
    if (answer === null && question.required) {
      return { ok: false, questionId: question.id, reason: "required" };
    }
    snapshot.push({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      required: question.required,
      ...(question.kind === "choice" ? { options: [...(question.options ?? [])] } : {}),
      answer,
    });
  }
  return { ok: true, snapshot };
}

/**
 * What "Save and finish later" keeps: every value that reads as a valid answer
 * to a question on the pinned template. Blanks and values the kind cannot hold
 * are dropped rather than refused: a draft is not evidence.
 */
export function draftShopAnswersFrom(
  questions: readonly ShopQuestion[],
  read: (questionId: string) => string | null | undefined,
): DraftShopAnswers | null {
  if (questions.length === 0) return null;
  const draft: DraftShopAnswers = {};
  for (const question of questions) {
    const answer = readShopAnswer(question, read(question.id));
    if (answer !== null && answer !== "invalid") draft[question.id] = answer;
  }
  return draft;
}

/**
 * A saved draft read back against the pinned questions: a value whose question
 * vanished, changed kind, or lost the option it named is dropped, so the page
 * never pre-fills an answer to a question the diver was not asked.
 */
export function restoreDraftShopAnswers(
  questions: readonly ShopQuestion[],
  draft: unknown,
): DraftShopAnswers {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return {};
  const saved = draft as Record<string, unknown>;
  const restored: DraftShopAnswers = {};
  for (const question of questions) {
    if (!Object.hasOwn(saved, question.id)) continue;
    const value = saved[question.id];
    if (holdsShopAnswer(question, value)) restored[question.id] = value;
  }
  return restored;
}

/**
 * The health words a locale lists, as the editor's bundle spells them: comma
 * separated, a trailing `*` matching any ending ("allerg*" catches "allergy"
 * and "allergies"). Without one, a word matches itself and its plural.
 */
export function parseHealthWords(list: string): string[] {
  return list
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

/** Lowercased with accents dropped, so "Médico" and "medico" are one word. */
function foldForMatch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The first health word a prompt contains, or null. Matched case- and
 * accent-insensitively at a word's start. The editor shows a warning beside
 * the question and **never** refuses it: a keyword list is brittle, and a
 * false positive costs one glance (dive-domain review, point 2).
 */
export function promptHealthWord(prompt: string, words: readonly string[]): string | null {
  const text = foldForMatch(prompt);
  for (const word of words) {
    const stem = foldForMatch(word.endsWith("*") ? word.slice(0, -1) : word);
    if (stem === "") continue;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tail = word.endsWith("*") ? "" : "(?:s|es)?(?![\\p{L}\\p{N}])";
    if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}${tail}`, "u").test(text)) return word;
  }
  return null;
}
