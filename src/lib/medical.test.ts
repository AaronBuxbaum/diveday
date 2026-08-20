import { describe, expect, it } from "vitest";
import {
  applicableMedicalQuestions,
  calculateMedicalResult,
  emptyMedicalAnswers,
  findQuestionnaireVersion,
  flaggedMedicalPrompts,
  medicalProgress,
  needsPhysicianReview,
  questionnaireForJurisdiction,
  RSTC_QUESTIONNAIRE,
  validateMedicalAnswers,
} from "./medical";

describe("medical questionnaires", () => {
  it("always uses the RSTC questionnaire", () => {
    expect(questionnaireForJurisdiction("rstc")).toBe(RSTC_QUESTIONNAIRE);
    expect(questionnaireForJurisdiction("uk")).toBe(RSTC_QUESTIONNAIRE);
  });

  it("matches the 2026 PDF version and exposes the conditional boxes", () => {
    expect(RSTC_QUESTIONNAIRE.version).toBe(2);
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
    expect(applicableMedicalQuestions(RSTC_QUESTIONNAIRE, answers.responses)).toHaveLength(16);
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
    // Ten numbered questions plus the dental check — never the 44-question
    // definition, most of which no answer has made applicable.
    expect(progress.total).toBe(11);
    expect(progress.primaryRemaining).toBe(10);
  });

  it("counts only the questions an answer has made applicable", () => {
    // q1 opens Box A, which has five questions of its own.
    const progress = medicalProgress(RSTC_QUESTIONNAIRE, { q1: true });
    expect(progress.total).toBe(16);
    expect(progress.answered).toBe(1);
    expect(progress.remaining).toBe(15);
    expect(progress.primaryRemaining).toBe(9);
  });

  it("is clear only when every applicable question is answered no", () => {
    expect(medicalProgress(RSTC_QUESTIONNAIRE, allNo).outcome).toBe("clear");
    const { dental_recovery: _omitted, ...missingDental } = allNo;
    expect(medicalProgress(RSTC_QUESTIONNAIRE, missingDental).outcome).not.toBe("clear");
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
