import { describe, expect, it } from "vitest";
import {
  buildShopAnswers,
  draftShopAnswersFrom,
  isShopQuestionId,
  newShopQuestionId,
  parseHealthWords,
  parseShopQuestions,
  promptHealthWord,
  questionsNotAskedBy,
  readPostedShopQuestions,
  readShopAnswer,
  restoreDraftShopAnswers,
  SHOP_QUESTIONS_FIELD_MAX,
  SHOP_QUESTIONS_MAX,
  type ShopQuestion,
  shopAnswerField,
  shopQuestionsEqual,
} from "./waiver-questions";

const dives: ShopQuestion = {
  id: "divecount01",
  kind: "number",
  prompt: "How many dives have you logged?",
  required: false,
};
const heard: ShopQuestion = {
  id: "heardabout1",
  kind: "choice",
  prompt: "How did you hear about us?",
  required: false,
  options: ["A friend", "Online search", "Our hotel"],
};
const insured: ShopQuestion = {
  id: "insurance01",
  kind: "yes_no",
  prompt: "Do you carry dive accident insurance?",
  required: true,
};

function reader(values: Record<string, string>) {
  return (id: string) => values[id] ?? null;
}

describe("parseShopQuestions", () => {
  it("accepts a list and returns it normalised, options only on a choice", () => {
    const parsed = parseShopQuestions([
      { ...dives, prompt: "  How many dives\r\nhave you logged?  ", options: ["stray"] },
      heard,
    ]);
    expect(parsed).toEqual({
      ok: true,
      questions: [{ ...dives, prompt: "How many dives have you logged?" }, heard],
    });
  });

  it("refuses more than fifteen questions", () => {
    const many = Array.from({ length: SHOP_QUESTIONS_MAX + 1 }, (_, index) => ({
      ...insured,
      id: `question${String(index).padStart(2, "0")}`,
    }));
    expect(parseShopQuestions(many)).toEqual({ ok: false, reason: "too_many" });
    expect(parseShopQuestions(many.slice(0, SHOP_QUESTIONS_MAX)).ok).toBe(true);
  });

  it("refuses a duplicate id and a malformed one", () => {
    expect(parseShopQuestions([insured, { ...dives, id: insured.id }])).toEqual({
      ok: false,
      reason: "duplicate_id",
      index: 1,
    });
    expect(parseShopQuestions([{ ...insured, id: "Not An Id" }])).toMatchObject({
      reason: "bad_id",
    });
    expect(parseShopQuestions([{ ...insured, id: "short" }])).toMatchObject({ reason: "bad_id" });
  });

  it("refuses an unknown kind, an empty or long prompt, and a non-boolean required", () => {
    expect(parseShopQuestions([{ ...insured, kind: "signature" }])).toMatchObject({
      reason: "bad_kind",
    });
    expect(parseShopQuestions([{ ...insured, prompt: "   " }])).toMatchObject({
      reason: "prompt_empty",
    });
    expect(parseShopQuestions([{ ...insured, prompt: "x".repeat(201) }])).toMatchObject({
      reason: "prompt_too_long",
    });
    expect(parseShopQuestions([{ ...insured, prompt: "x".repeat(200) }]).ok).toBe(true);
    expect(parseShopQuestions([{ ...insured, required: "yes" }])).toMatchObject({
      reason: "malformed",
    });
    expect(parseShopQuestions("[]")).toEqual({ ok: false, reason: "malformed" });
  });

  it("holds a choice to 2 to 8 distinct options of at most 80 characters", () => {
    expect(parseShopQuestions([{ ...heard, options: ["Only one"] }])).toMatchObject({
      reason: "options_count",
    });
    expect(
      parseShopQuestions([{ ...heard, options: Array.from({ length: 9 }, (_, i) => `Opt ${i}`) }]),
    ).toMatchObject({ reason: "options_count" });
    expect(parseShopQuestions([{ ...heard, options: ["A", "A"] }])).toMatchObject({
      reason: "duplicate_option",
    });
    expect(parseShopQuestions([{ ...heard, options: ["A", " "] }])).toMatchObject({
      reason: "option_empty",
    });
    expect(parseShopQuestions([{ ...heard, options: ["A", "b".repeat(81)] }])).toMatchObject({
      reason: "option_too_long",
    });
  });

  // Security review M2: the count is checked before any per-option work, so a
  // 16 MB body of distinct options is refused in one comparison, not in
  // minutes of quadratic duplicate checks.
  it("refuses a huge option list on its count, before reading a single option", () => {
    const options = Array.from({ length: 200_000 }, (_, i) => String(i));
    const started = performance.now();
    expect(parseShopQuestions([{ ...heard, options }])).toEqual({
      ok: false,
      reason: "options_count",
      index: 0,
    });
    expect(performance.now() - started).toBeLessThan(50);
    // And a list of more than fifteen is refused before any question is read.
    const many = Array.from({ length: 100_000 }, () => ({ ...heard, options }));
    const startedMany = performance.now();
    expect(parseShopQuestions(many)).toEqual({ ok: false, reason: "too_many" });
    expect(performance.now() - startedMany).toBeLessThan(50);
  });

  it("caps the posted list's length before it is parsed", () => {
    expect(SHOP_QUESTIONS_FIELD_MAX).toBeGreaterThan(
      JSON.stringify(
        Array.from({ length: SHOP_QUESTIONS_MAX }, (_, i) => ({
          id: `question${String(i).padStart(4, "0")}`,
          kind: "choice",
          prompt: "p".repeat(200),
          required: true,
          options: Array.from({ length: 8 }, (_, j) => `${j}${"o".repeat(79)}`),
        })),
      ).length,
    );
    const started = performance.now();
    expect(readPostedShopQuestions("x".repeat(16 * 1024 * 1024))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(readPostedShopQuestions("{not json")).toEqual({ ok: false, reason: "malformed" });
    expect(readPostedShopQuestions(JSON.stringify([heard]))).toEqual({
      ok: true,
      questions: [heard],
    });
    expect(performance.now() - started).toBeLessThan(50);
  });

  // Security review L1: Postgres jsonb cannot hold U+0000, so a control
  // character is refused here rather than failing the write with a 500.
  it("refuses a control character in a prompt or an option", () => {
    expect(parseShopQuestions([{ ...insured, prompt: "Insured\u0000?" }])).toMatchObject({
      reason: "control_character",
      index: 0,
    });
    expect(parseShopQuestions([{ ...insured, prompt: "Insured\u0007?" }])).toMatchObject({
      reason: "control_character",
    });
    expect(parseShopQuestions([{ ...heard, options: ["A\u0000", "B"] }])).toMatchObject({
      reason: "control_character",
    });
    // A tab pasted into a one-line prompt or option is a space.
    expect(parseShopQuestions([{ ...heard, options: ["A\tfriend", "B"] }])).toMatchObject({
      ok: true,
      questions: [{ options: ["A friend", "B"] }],
    });
    // A pasted line break in a prompt is still folded to a space.
    expect(parseShopQuestions([{ ...insured, prompt: "Insured\n?" }]).ok).toBe(true);
  });

  /** A shop may write any words it likes: a health word warns in the editor, never refuses. */
  it("never refuses a prompt for its words", () => {
    expect(
      parseShopQuestions([
        { ...insured, prompt: "Do you have a heart condition or take medication?" },
      ]).ok,
    ).toBe(true);
  });
});

describe("shopQuestionsEqual", () => {
  it("is equal after normalisation, so a pasted prompt is not a new version", () => {
    const decomposed = { ...heard, prompt: "How did you hear about us?".normalize("NFD") };
    expect(
      shopQuestionsEqual(
        [dives, heard],
        [dives, { ...decomposed, prompt: ` ${decomposed.prompt} ` }],
      ),
    ).toBe(true);
  });

  it("differs on id, order, kind, prompt, options or required", () => {
    const base = [dives, heard, insured];
    expect(shopQuestionsEqual(base, [heard, dives, insured])).toBe(false);
    expect(shopQuestionsEqual(base, [{ ...dives, id: "divecount02" }, heard, insured])).toBe(false);
    expect(shopQuestionsEqual(base, [{ ...dives, kind: "text" }, heard, insured])).toBe(false);
    expect(shopQuestionsEqual(base, [{ ...dives, prompt: "Dives logged?" }, heard, insured])).toBe(
      false,
    );
    expect(
      shopQuestionsEqual(base, [
        dives,
        { ...heard, options: ["A friend", "Online search"] },
        insured,
      ]),
    ).toBe(false);
    expect(shopQuestionsEqual(base, [dives, heard, { ...insured, required: false }])).toBe(false);
    expect(shopQuestionsEqual(base, [dives, heard])).toBe(false);
  });
});

/**
 * "Asked now, not on this release" (dive-domain reviews 1 S1, 2 S3 and S5):
 * decided from the version the record was signed on, never from which
 * answers are missing.
 */
describe("questionsNotAskedBy", () => {
  it("lists a current question the signed version did not have", () => {
    expect(questionsNotAskedBy([dives], [dives, insured])).toEqual([insured]);
    expect(questionsNotAskedBy([], [dives])).toEqual([dives]);
    expect(questionsNotAskedBy([dives, insured], [dives, insured])).toEqual([]);
  });

  it("lists a question reworded, retyped or given other options under the same id", () => {
    const reworded = { ...heard, prompt: "Do you carry dive accident insurance?" };
    const retyped: ShopQuestion = { ...dives, kind: "text" };
    const reoptioned = { ...heard, options: ["A friend", "Instagram"] };
    expect(questionsNotAskedBy([heard, dives], [reworded, retyped])).toEqual([reworded, retyped]);
    expect(questionsNotAskedBy([heard], [reoptioned])).toEqual([reoptioned]);
  });

  it("does not list a question that only changed spacing, Unicode form or whether it is required", () => {
    expect(
      questionsNotAskedBy(
        [heard],
        [{ ...heard, prompt: `  ${heard.prompt.normalize("NFD")} `, required: true }],
      ),
    ).toEqual([]);
  });

  it("never reads the answers, so a question left blank or erased is not listed", () => {
    // The helper takes questions only: a snapshot with every answer null, or
    // none at all, cannot make a question the version asked read "not asked".
    expect(questionsNotAskedBy([dives, heard, insured], [dives, heard, insured])).toEqual([]);
  });
});

describe("readShopAnswer", () => {
  it("reads each kind and refuses what it cannot hold", () => {
    expect(readShopAnswer(insured, "yes")).toBe(true);
    expect(readShopAnswer(insured, "no")).toBe(false);
    expect(readShopAnswer(insured, "maybe")).toBe("invalid");
    expect(readShopAnswer(dives, "40")).toBe(40);
    expect(readShopAnswer(dives, "100000")).toBe(100_000);
    expect(readShopAnswer(dives, "100001")).toBe("invalid");
    expect(readShopAnswer(dives, "-1")).toBe("invalid");
    expect(readShopAnswer(dives, "4.5")).toBe("invalid");
    expect(readShopAnswer(heard, "A friend")).toBe("A friend");
    expect(readShopAnswer(heard, "A cousin")).toBe("invalid");
    const date: ShopQuestion = {
      id: "lastdive001",
      kind: "date",
      prompt: "When?",
      required: false,
    };
    expect(readShopAnswer(date, "2026-02-29")).toBe("invalid");
    expect(readShopAnswer(date, "2028-02-29")).toBe("2028-02-29");
    const text: ShopQuestion = { id: "anything01", kind: "text", prompt: "Else?", required: false };
    expect(readShopAnswer(text, "x".repeat(500))).toBe("x".repeat(500));
    expect(readShopAnswer(text, "x".repeat(501))).toBe("invalid");
    expect(readShopAnswer(text, "   ")).toBeNull();
  });
});

describe("control characters in answers (security review L1)", () => {
  const note: ShopQuestion = {
    id: "notetext01",
    kind: "text",
    prompt: "Anything else?",
    required: false,
  };

  it("refuses a NUL or other control character in a text answer, and keeps newlines and tabs", () => {
    expect(readShopAnswer(note, "a\u0000b")).toBe("invalid");
    expect(readShopAnswer(note, "a\u001bb")).toBe("invalid");
    expect(readShopAnswer(note, "line one\nline two\tend")).toBe("line one\nline two\tend");
    expect(buildShopAnswers([note], () => "a\u0000b")).toEqual({
      ok: false,
      questionId: note.id,
      reason: "invalid",
    });
  });

  it("never saves a draft value holding a control character", () => {
    expect(draftShopAnswersFrom([note], () => "a\u0000b")).toEqual({});
    expect(restoreDraftShopAnswers([note], { [note.id]: "a\u0000b" })).toEqual({});
  });
});

describe("buildShopAnswers", () => {
  it("is null when the template asks nothing, never an empty list", () => {
    expect(buildShopAnswers([], reader({}))).toEqual({ ok: true, snapshot: null });
  });

  it("snapshots every question as asked, with null for an optional one left blank", () => {
    const outcome = buildShopAnswers(
      [dives, heard, insured],
      reader({ [dives.id]: "40", [insured.id]: "no" }),
    );
    expect(outcome).toEqual({
      ok: true,
      snapshot: [
        { ...dives, answer: 40 },
        { ...heard, answer: null },
        { ...insured, answer: false },
      ],
    });
  });

  /** B1: `required` is answered, never a particular answer. */
  it("accepts a required yes_no answered no", () => {
    const fit: ShopQuestion = {
      id: "fittodive01",
      kind: "yes_no",
      prompt: "I confirm I am medically fit to dive",
      required: true,
    };
    expect(buildShopAnswers([fit], reader({ [fit.id]: "no" }))).toMatchObject({ ok: true });
  });

  it("names the first refused question in the shop's order", () => {
    expect(buildShopAnswers([dives, insured], reader({ [dives.id]: "lots" }))).toEqual({
      ok: false,
      questionId: dives.id,
      reason: "invalid",
    });
    expect(buildShopAnswers([dives, insured], reader({}))).toEqual({
      ok: false,
      questionId: insured.id,
      reason: "required",
    });
  });

  it("reads answers by id only, so the question's wording comes from the template", () => {
    const outcome = buildShopAnswers([insured], (id) =>
      id === insured.id ? "yes" : "a submitted prompt",
    );
    expect(outcome).toMatchObject({ ok: true, snapshot: [{ prompt: insured.prompt }] });
  });
});

describe("drafts", () => {
  // Dive-domain review 2, S6: a number box the diver typed into never comes
  // back empty, and the value is still refused at signing.
  it("keeps a number answer that is not a whole number as typed, never sealing it", () => {
    expect(draftShopAnswersFrom([dives], () => "40ish")).toEqual({ [dives.id]: "40ish" });
    expect(restoreDraftShopAnswers([dives], { [dives.id]: "40ish" })).toEqual({
      [dives.id]: "40ish",
    });
    expect(buildShopAnswers([dives], () => "40ish")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    // Longer than the box takes, or carrying a control character: dropped.
    expect(draftShopAnswersFrom([dives], () => "1234567")).toEqual({});
    expect(restoreDraftShopAnswers([dives], { [dives.id]: "4\u00000" })).toEqual({});
  });

  it("keeps valid values on save and drops a choice or yes/no it cannot hold", () => {
    expect(
      draftShopAnswersFrom(
        [dives, heard, insured],
        reader({ [dives.id]: "40", [heard.id]: "Not an option", [insured.id]: "maybe" }),
      ),
    ).toEqual({ [dives.id]: 40 });
    expect(draftShopAnswersFrom([], reader({}))).toBeNull();
  });

  it("drops a value whose question vanished, changed kind or lost its option", () => {
    const draft = {
      [dives.id]: 40,
      [heard.id]: "A cousin",
      [insured.id]: "yes",
      gonequestion1: true,
    };
    expect(restoreDraftShopAnswers([dives, heard, insured], draft)).toEqual({ [dives.id]: 40 });
    expect(restoreDraftShopAnswers([dives], null)).toEqual({});
    expect(restoreDraftShopAnswers([dives], ["40"])).toEqual({});
  });
});

describe("health words", () => {
  const words = parseHealthWords(
    "medical, medication, condition, health, doctor, allerg*, asthma, heart, pregnan*, surgery, injury",
  );

  it("matches case-insensitively at a word's start, with stems and plurals", () => {
    expect(promptHealthWord("Medical alert information", words)).toBe("medical");
    expect(promptHealthWord("Any ALLERGIES we should know about?", words)).toBe("allerg*");
    expect(promptHealthWord("Are you pregnant?", words)).toBe("pregnan*");
    expect(promptHealthWord("Any injuries this year?", words)).toBeNull();
    expect(promptHealthWord("Any injury this year?", words)).toBe("injury");
    expect(promptHealthWord("Heart conditions?", words)).toBe("condition");
  });

  it("leaves an ordinary prompt alone, including DAN insurance", () => {
    expect(promptHealthWord("Do you carry dive accident insurance (DAN)?", words)).toBeNull();
    expect(promptHealthWord("How did you hear about us?", words)).toBeNull();
    expect(promptHealthWord("Your sweetheart's name", words)).toBeNull();
  });

  it("folds accents, so a Spanish list matches either spelling", () => {
    const spanish = parseHealthWords("médic*, corazón, alergi*");
    expect(promptHealthWord("¿Tiene alguna condición del CORAZON?", spanish)).toBe("corazón");
    expect(promptHealthWord("Nombre de su medico", spanish)).toBe("médic*");
  });
});

describe("ids and fields", () => {
  it("mints ids the server accepts, and posts them apart from the medical form", () => {
    const id = newShopQuestionId();
    expect(isShopQuestionId(id)).toBe(true);
    expect(newShopQuestionId()).not.toBe(id);
    expect(shopAnswerField(id)).toBe(`sq_${id}`);
  });
});
