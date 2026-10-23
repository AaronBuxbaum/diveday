import { describe, expect, it } from "vitest";
import {
  buildShopAnswers,
  draftShopAnswersFrom,
  isShopQuestionId,
  newShopQuestionId,
  parseHealthWords,
  parseShopQuestions,
  promptHealthWord,
  readShopAnswer,
  restoreDraftShopAnswers,
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
  it("keeps only valid values on save", () => {
    expect(
      draftShopAnswersFrom(
        [dives, heard, insured],
        reader({ [dives.id]: "lots", [heard.id]: "A friend", [insured.id]: "yes" }),
      ),
    ).toEqual({ [heard.id]: "A friend", [insured.id]: true });
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
