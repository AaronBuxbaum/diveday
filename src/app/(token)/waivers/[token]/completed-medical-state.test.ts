import { describe, expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { type CompletedMedicalRecord, completedMedicalState } from "./completed-medical-state";

const clearAnswers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const medicalReferralAnswers = {
  ...clearAnswers,
  responses: { ...clearAnswers.responses, q3: true },
};
const held: CompletedMedicalRecord = {
  status: "medical_review",
  supersededAt: null,
  medicalClearedAt: null,
  medicalClearanceDeclinedAt: null,
  medicalAnswers: medicalReferralAnswers,
  diverMedicalFormSentAt: null,
};
describe("the signed receipt’s medical next step", () => {
  it("distinguishes an actual referral from status-only and incomplete review", () => {
    expect(completedMedicalState(held)).toBe("referral");
    expect(completedMedicalState({ ...held, medicalAnswers: null })).toBe("shop_review");
    expect(completedMedicalState({ ...held, medicalAnswers: clearAnswers })).toBe("shop_review");
    expect(
      completedMedicalState({
        ...held,
        medicalAnswers: { ...medicalReferralAnswers, questionnaireVersion: 999 },
      }),
    ).toBe("shop_review");
    expect(
      completedMedicalState({
        ...held,
        medicalAnswers: { ...medicalReferralAnswers, responses: {} },
      }),
    ).toBe("shop_review");
  });
  it("a sent form is receipt only; a recorded refusal stops chasing another form", () => {
    const at = new Date("2026-10-26T12:00:00Z");
    expect(completedMedicalState({ ...held, diverMedicalFormSentAt: at })).toBe("form_sent");
    expect(
      completedMedicalState({
        ...held,
        diverMedicalFormSentAt: at,
        medicalClearanceDeclinedAt: at,
      }),
    ).toBe("declined");
    expect(completedMedicalState({ ...held, medicalClearedAt: at })).toBe("complete");
  });
  it("does not revive holds on completed or superseded releases", () => {
    expect(completedMedicalState({ ...held, status: "completed" })).toBe("complete");
    expect(completedMedicalState({ ...held, supersededAt: new Date("2026-10-26T12:00:00Z") })).toBe(
      "complete",
    );
  });
});
