import { describe, expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { overriddenReferral, shopWaiverStatus } from "./waivers";

type TestWaiver = NonNullable<Parameters<typeof overriddenReferral>[0]>;

const clear = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const SIGN_NOW = new Date("2026-07-18T12:00:00.000Z");
const [heartId] = RSTC_QUESTIONNAIRE.questions
  .filter((question) => question.referral)
  .map((question) => question.id);

function completedWaiver(overrides: Partial<TestWaiver> = {}): TestWaiver {
  const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
  return {
    id: "record-1",
    bookingId: "booking-1",
    personId: "person-1",
    status: "completed",
    templateVersion: 1,
    templateGeneration: 1,
    signedAt,
    completedAt: signedAt,
    supersededAt: null,
    expiresAt: new Date(SIGN_NOW.getTime() - 30_000),
    createdAt: new Date(SIGN_NOW.getTime() - 120_000),
    ...overrides,
  } as TestWaiver;
}

describe("medical referral warnings use the shop-local calendar", () => {
  it("keeps a Tokyo referral open when the only matching clearance is on the prior shop day", () => {
    const referredAt = new Date("2026-07-18T15:30:00.000Z");
    const referral = completedWaiver({
      id: "tokyo-referral",
      status: "medical_review",
      medicalAnswers: {
        ...clear,
        responses: { ...clear.responses, [heartId ?? "q3"]: true },
      },
      signedAt: referredAt,
      completedAt: referredAt,
    });
    const earlierClearance = completedWaiver({
      id: "tokyo-earlier-clearance",
      status: "medical_review",
      medicalAnswers: {
        ...clear,
        responses: { ...clear.responses, [heartId ?? "q3"]: true },
      },
      signedAt: new Date("2026-07-18T16:00:00.000Z"),
      completedAt: new Date("2026-07-18T16:00:00.000Z"),
      medicalClearanceEvaluatedOn: "2026-07-18",
      medicalClearedAt: new Date("2026-07-18T16:00:00.000Z"),
    });
    const standingAt = new Date("2026-07-19T16:30:00.000Z");
    const standing = completedWaiver({
      id: "tokyo-standing-release",
      medicalAnswers: clear,
      signedAt: standingAt,
      completedAt: standingAt,
    });
    const records = [earlierClearance, referral, standing];

    expect(overriddenReferral(standing, records, "Asia/Tokyo")?.recordId).toBe(referral.id);
    expect(overriddenReferral(standing, records, "UTC")).toBeNull();
    expect(
      shopWaiverStatus({
        personSignedWaivers: records,
        currentTemplateVersion: 1,
        now: new Date("2026-07-20T00:00:00.000Z"),
        signer: { dateOfBirth: null, minorDeclared: false, timezone: "Asia/Tokyo" },
      }),
    ).toMatchObject({
      state: "current",
      medical: { overriddenReferral: { recordId: referral.id, personId: referral.personId } },
    });
  });
});
