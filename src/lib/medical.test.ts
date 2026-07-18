import { describe, expect, it } from "vitest";
import {
  emptyMedicalAnswers,
  findQuestionnaire,
  flaggedMedicalPrompts,
  needsPhysicianReview,
  questionnaireForJurisdiction,
  RSTC_QUESTIONNAIRE,
  UK_QUESTIONNAIRE,
} from "./medical";

describe("medical questionnaires", () => {
  it("selects the questionnaire for a jurisdiction, defaulting to RSTC", () => {
    expect(questionnaireForJurisdiction("rstc")).toBe(RSTC_QUESTIONNAIRE);
    expect(questionnaireForJurisdiction("uk")).toBe(UK_QUESTIONNAIRE);
  });

  it("clears review only when every answer is no", () => {
    expect(needsPhysicianReview(emptyMedicalAnswers(RSTC_QUESTIONNAIRE))).toBe(false);
  });

  it("requires review for any referral-flagged yes", () => {
    const referral = RSTC_QUESTIONNAIRE.questions.find((q) => q.referral);
    if (!referral) throw new Error("expected a referral question");
    const answers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
    answers.responses[referral.id] = true;
    expect(needsPhysicianReview(answers)).toBe(true);
    expect(flaggedMedicalPrompts(answers)).toContain(referral.prompt);
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
