import { describe, expect, it } from "vitest";
import {
  applicableMedicalQuestions,
  applicableResponsesOnly,
  calculateMedicalResult,
  emptyMedicalAnswers,
  findQuestionnaireVersion,
  flaggedMedicalPrompts,
  medicalProgress,
  needsPhysicianReview,
  questionnaireForJurisdiction,
  RSTC_QUESTIONNAIRE,
  readMedicalAnswers,
  validateMedicalAnswers,
} from "./medical";

describe("medical questionnaires", () => {
  it("always uses the RSTC questionnaire", () => {
    expect(questionnaireForJurisdiction("rstc")).toBe(RSTC_QUESTIONNAIRE);
    expect(questionnaireForJurisdiction("uk")).toBe(RSTC_QUESTIONNAIRE);
  });

  it("matches the 2026 PDF version and exposes the conditional boxes", () => {
    expect(RSTC_QUESTIONNAIRE.version).toBe(3);
    expect(RSTC_QUESTIONNAIRE.questions).toHaveLength(44);
    expect(RSTC_QUESTIONNAIRE.questions.find((question) => question.id === "q1")?.referral).toBe(
      false,
    );
    expect(RSTC_QUESTIONNAIRE.questions.find((question) => question.id === "q3")?.referral).toBe(
      true,
    );
  });

  it("clears review when question 1 is yes but every applicable Box A answer is no", () => {
    const answers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    answers.responses.q1 = true;
    for (const question of RSTC_QUESTIONNAIRE.questions.filter((q) => q.parentId === "q1")) {
      answers.responses[question.id] = false;
    }
    expect(applicableMedicalQuestions(RSTC_QUESTIONNAIRE, answers.responses)).toHaveLength(15);
    expect(calculateMedicalResult(answers)).toMatchObject({ status: "clear" });
    expect(needsPhysicianReview(emptyMedicalAnswers(RSTC_QUESTIONNAIRE))).toBe(false);
  });

  it("requires review for direct questions and affirmative Box answers", () => {
    const answers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    answers.responses.q3 = true;
    expect(needsPhysicianReview(answers)).toBe(true);
    expect(flaggedMedicalPrompts(answers)).toContain(
      RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q3")?.prompt,
    );

    const boxAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    boxAnswers.responses.q1 = true;
    boxAnswers.responses.box_a_1 = true;
    expect(calculateMedicalResult(boxAnswers).status).toBe("physician_review");
  });

  it("fails closed for incomplete current answers and no longer resolves the retired v1 questionnaire", () => {
    const incomplete = { ...emptyMedicalAnswers(RSTC_QUESTIONNAIRE), responses: { q1: true } };
    expect(validateMedicalAnswers(incomplete, { requireComplete: true })).toMatchObject({
      ok: false,
    });
    expect(calculateMedicalResult(incomplete).status).toBe("incomplete");
    expect(findQuestionnaireVersion("rstc", 1)).toBeNull();
  });

  it("still reads a v2 record under v2's rules after the dental item moved into Box C", () => {
    // v2 asked "still healing from a dental procedure" of every diver; v3 puts
    // it where the published form does, as Box C's fifth item behind q4. A
    // diver who answered no to q4 and yes to the dental question is somebody a
    // physician was asked to see. Read under v3 that answer is not applicable
    // and the record would come back clear — which is a boarding hold lifting
    // itself. The version stamp on the stored row is the only thing standing
    // between those two readings, so this is the test that guards it.
    const v2 = findQuestionnaireVersion("rstc", 2);
    expect(v2?.version).toBe(2);
    const dental = v2?.questions.find((question) => question.id === "dental_recovery");
    expect(dental).toMatchObject({ section: "dental", referral: true });
    expect(dental?.parentId).toBeUndefined();

    const responses: Record<string, boolean> = Object.fromEntries(
      (v2?.questions ?? [])
        .filter((question) => !question.parentId)
        .map((question) => [question.id, false]),
    );
    responses.dental_recovery = true;

    expect(
      needsPhysicianReview({ questionnaireId: "rstc", questionnaireVersion: 2, responses }),
    ).toBe(true);

    // And the same answers stamped v3 are not silently "clear" either: under v3
    // `dental_recovery` is not a question at all, so validation refuses the row
    // rather than dropping the answer on the floor.
    expect(
      needsPhysicianReview({ questionnaireId: "rstc", questionnaireVersion: 3, responses }),
    ).toBe(true);
  });

  it("puts the dental item where the published form puts it", () => {
    // Checked against the 2026-01-01 PDF (product 10346 EN): Box C carries five
    // items and the fifth is the dental one. Appended rather than inserted,
    // because `box_c_1`..`box_c_4` are the stored answer keys.
    const boxC = RSTC_QUESTIONNAIRE.questions.filter((question) => question.section === "box_c");
    expect(boxC.map((question) => question.id)).toEqual([
      "box_c_1",
      "box_c_2",
      "box_c_3",
      "box_c_4",
      "box_c_5",
    ]);
    expect(boxC[4]).toMatchObject({ parentId: "q4", referral: true });
    expect(boxC[4]?.prompt).toContain("dental");
    // Nothing outside a Box is asked of everyone any more.
    expect(RSTC_QUESTIONNAIRE.questions.some((question) => question.section === "dental")).toBe(
      false,
    );
  });

  it("fails closed for an unknown questionnaire or unrecognized question", () => {
    expect(
      needsPhysicianReview({
        questionnaireId: "does-not-exist",
        questionnaireVersion: 1,
        responses: { anything: true },
      }),
    ).toBe(true);
    expect(
      needsPhysicianReview({
        questionnaireId: RSTC_QUESTIONNAIRE.id,
        questionnaireVersion: RSTC_QUESTIONNAIRE.version,
        responses: { not_a_real_question: true },
      }),
    ).toBe(true);
  });
});

/**
 * What the diver is told while they are still filling the form in.
 *
 * This never records a status — `calculateMedicalResult` remains the verdict of
 * record and is the only thing a signature is built from. What matters here is
 * that the two can never *disagree* about a referral, and that a half-answered
 * form is never described as clear.
 */
describe("live questionnaire progress", () => {
  const answers = (responses: Record<string, boolean>) => ({
    questionnaireId: RSTC_QUESTIONNAIRE.id,
    questionnaireVersion: RSTC_QUESTIONNAIRE.version,
    responses,
  });
  /** Every page-one question plus the dental check, answered no. */
  const allNo = Object.fromEntries(
    RSTC_QUESTIONNAIRE.questions
      .filter((question) => !question.parentId)
      .map((question) => [question.id, false]),
  );

  it("says nothing at all before the first answer", () => {
    const progress = medicalProgress(RSTC_QUESTIONNAIRE, {});
    expect(progress.outcome).toBe("unanswered");
    expect(progress.answered).toBe(0);
    // The ten numbered questions and nothing else — never the 44-question
    // definition, most of which no answer has made applicable.
    expect(progress.total).toBe(10);
    expect(progress.primaryRemaining).toBe(10);
  });

  it("counts only the questions an answer has made applicable", () => {
    // q1 opens Box A, which has five questions of its own.
    const progress = medicalProgress(RSTC_QUESTIONNAIRE, { q1: true });
    expect(progress.total).toBe(15);
    expect(progress.answered).toBe(1);
    expect(progress.remaining).toBe(14);
    expect(progress.primaryRemaining).toBe(9);
  });

  it("is clear only when every applicable question is answered no", () => {
    expect(medicalProgress(RSTC_QUESTIONNAIRE, allNo).outcome).toBe("clear");
    const { q4: _omitted, ...missingQ4 } = allNo;
    expect(medicalProgress(RSTC_QUESTIONNAIRE, missingQ4).outcome).not.toBe("clear");
  });

  it("reports a referral the moment one is given, before the form is complete", () => {
    // q3 is asterisked on the published form: a yes is itself a referral.
    const progress = medicalProgress(RSTC_QUESTIONNAIRE, { q3: true });
    expect(progress.outcome).toBe("referral");
    expect(progress.remaining).toBeGreaterThan(0);
  });

  it("does not call a box-opening yes a referral on its own", () => {
    expect(medicalProgress(RSTC_QUESTIONNAIRE, { q1: true }).outcome).toBe("in_progress");
    expect(medicalProgress(RSTC_QUESTIONNAIRE, { q1: true, box_a_1: true }).outcome).toBe(
      "referral",
    );
  });

  it("points at the open box once every page-one question is answered", () => {
    const progress = medicalProgress(RSTC_QUESTIONNAIRE, { ...allNo, q1: true });
    expect(progress.outcome).toBe("follow_ups_open");
    expect(progress.primaryRemaining).toBe(0);
    expect(progress.remaining).toBe(5);
  });

  it("agrees with the verdict of record on a complete form", () => {
    // The two derive the same rule from the same answers; a live line that said
    // "no evaluation required" over a record marked for physician review would
    // be worse than saying nothing.
    const cleared = { ...allNo };
    expect(medicalProgress(RSTC_QUESTIONNAIRE, cleared).outcome).toBe("clear");
    expect(calculateMedicalResult(answers(cleared)).status).toBe("clear");

    const flagged = { ...allNo, q10: true };
    expect(medicalProgress(RSTC_QUESTIONNAIRE, flagged).outcome).toBe("referral");
    expect(calculateMedicalResult(answers(flagged)).status).toBe("physician_review");
  });

  it("treats a closed branch's stale yes as out of scope, like the verdict does", () => {
    // The form component clears children when a parent flips to no, but a
    // hand-built payload can still carry one. Neither surface may count it.
    const stale = { ...allNo, q1: false, box_a_1: true };
    expect(medicalProgress(RSTC_QUESTIONNAIRE, stale).outcome).toBe("clear");
    expect(calculateMedicalResult(answers(stale)).status).toBe("clear");
  });
});

/**
 * **The one function that decides what enters a signed medical record**, and
 * until issue #1135 the one with no test — it lived in `page.tsx` as a private
 * helper, so nothing could reach it.
 *
 * Two properties matter here and neither was pinned. A Box the diver was never
 * asked to open must contribute *nothing*, not an explicit no; and the answer
 * must not depend on where a question sits in the literal.
 */
describe("reading a submitted questionnaire", () => {
  const BOX_PARENTS = RSTC_QUESTIONNAIRE.questions.filter((question) => !question.parentId);
  const CHILDREN = RSTC_QUESTIONNAIRE.questions.filter((question) => question.parentId);

  /** Answers every primary the given way and every Box child "no". */
  const answering = (primary: "yes" | "no") => (questionId: string) =>
    CHILDREN.some((child) => child.id === questionId) ? ("no" as const) : primary;

  it("stores nothing for a Box the diver was never asked to open", () => {
    // The paper form leaves an unasked Box item blank. An explicit `false` is
    // the deviation, and it is what a draft used to carry for all of them.
    const answers = readMedicalAnswers(RSTC_QUESTIONNAIRE, answering("no"));
    expect(answers).not.toBeNull();
    for (const child of CHILDREN) {
      expect(answers?.responses, `${child.id} must be absent, not false`).not.toHaveProperty(
        child.id,
      );
    }
    expect(Object.keys(answers?.responses ?? {})).toHaveLength(BOX_PARENTS.length);
  });

  it("stores a Box's answers once its parent is yes", () => {
    const parent = CHILDREN[0]?.parentId;
    if (!parent) throw new Error("the questionnaire has no branching question");
    const answers = readMedicalAnswers(RSTC_QUESTIONNAIRE, (questionId) =>
      questionId === parent ? "yes" : "no",
    );
    const opened = CHILDREN.filter((child) => child.parentId === parent);
    expect(opened.length).toBeGreaterThan(0);
    for (const child of opened) {
      expect(answers?.responses[child.id]).toBe(false);
    }
  });

  it("does not depend on where a question sits in the list", () => {
    // It used to resolve a child's parent out of the map it was still
    // building, so it was correct only because the literal happens to list
    // every primary before any Box child. Moving a Box's items to sit under
    // the parent they belong to — an ordinary edit to a 40-item literal —
    // would have made it write `false` for a child *without reading the form*,
    // recording a real yes as a no.
    const reversed = {
      ...RSTC_QUESTIONNAIRE,
      questions: [...RSTC_QUESTIONNAIRE.questions].reverse(),
    };
    const parent = CHILDREN[0]?.parentId;
    if (!parent) throw new Error("the questionnaire has no branching question");
    const read = (questionId: string) => (questionId === parent ? "yes" : ("yes" as const));
    expect(readMedicalAnswers(reversed, read)?.responses).toEqual(
      readMedicalAnswers(RSTC_QUESTIONNAIRE, read)?.responses,
    );
  });

  it("refuses an incomplete set, and tolerates one when asked to", () => {
    const missingOne = (questionId: string) =>
      questionId === BOX_PARENTS[0]?.id ? null : ("no" as const);
    expect(readMedicalAnswers(RSTC_QUESTIONNAIRE, missingOne)).toBeNull();
    const draft = readMedicalAnswers(RSTC_QUESTIONNAIRE, missingOne, { allowIncomplete: true });
    expect(draft).not.toBeNull();
    expect(draft?.responses).not.toHaveProperty(BOX_PARENTS[0]?.id ?? "");
  });
});

describe("pruning inapplicable answers", () => {
  it("drops a child whose parent is unanswered or no, and keeps one whose parent is yes", () => {
    const parent = RSTC_QUESTIONNAIRE.questions.find((question) => !question.parentId);
    const child = RSTC_QUESTIONNAIRE.questions.find((question) => question.parentId);
    if (!parent || !child) throw new Error("the questionnaire has no branching question");
    const other = RSTC_QUESTIONNAIRE.questions.find(
      (question) => question.parentId === child.parentId && question.id !== child.id,
    );

    // Parent unanswered — the draft-restore shape.
    expect(applicableResponsesOnly(RSTC_QUESTIONNAIRE, { [child.id]: false })).toEqual({});
    // Parent no.
    expect(
      applicableResponsesOnly(RSTC_QUESTIONNAIRE, {
        [child.parentId ?? ""]: false,
        [child.id]: true,
      }),
    ).toEqual({ [child.parentId ?? ""]: false });
    // Parent yes: the child's own answer is the diver's and survives.
    const open = {
      [child.parentId ?? ""]: true,
      [child.id]: true,
      ...(other ? { [other.id]: false } : {}),
    };
    expect(applicableResponsesOnly(RSTC_QUESTIONNAIRE, open)).toEqual(open);
  });

  it("drops a key the questionnaire does not have at all", () => {
    expect(applicableResponsesOnly(RSTC_QUESTIONNAIRE, { not_a_question: true })).toEqual({});
  });
});
