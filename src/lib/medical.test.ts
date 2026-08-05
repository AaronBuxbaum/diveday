import { describe, expect, it } from "vitest";
import {
  applicableMedicalQuestions,
  calculateMedicalResult,
  emptyMedicalAnswers,
  findQuestionnaire,
  findQuestionnaireVersion,
  flaggedMedicalPrompts,
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

  it("fails closed for incomplete current answers and accepts legacy v1 lookup", () => {
    const incomplete = { ...emptyMedicalAnswers(RSTC_QUESTIONNAIRE), responses: { q1: true } };
    expect(validateMedicalAnswers(incomplete, { requireComplete: true })).toMatchObject({
      ok: false,
    });
    expect(calculateMedicalResult(incomplete).status).toBe("incomplete");
    expect(findQuestionnaireVersion("rstc", 1)?.version).toBe(1);
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

  it("looks up the questionnaire a stored answer was captured against", () => {
    expect(findQuestionnaire("rstc")).toBe(RSTC_QUESTIONNAIRE);
    expect(findQuestionnaire("nope")).toBeNull();
  });
});
