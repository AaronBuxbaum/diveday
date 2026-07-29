import { describe, expect, it, vi } from "vitest";
import { computeWaiverIntegrityHash, verifyWaiverIntegrity } from "./waiver-integrity";

const record = {
  id: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000002",
  bookingId: null,
  personId: "00000000-0000-4000-8000-000000000003",
  templateId: "00000000-0000-4000-8000-000000000004",
  templateTitle: "Release",
  templateVersion: 1,
  templateBody: "I agree",
  status: "completed" as const,
  tokenHash: "token",
  expiresAt: new Date("2026-07-29T00:00:00.000Z"),
  startedAt: null,
  supersededAt: null,
  draftSignerName: null,
  draftAcknowledged: false,
  draftMedicalAnswers: null,
  signedName: "Nora Quinn",
  signatureMethod: "typed_consent",
  recordedByPersonId: null,
  consentedAt: new Date("2026-07-29T01:00:00.000Z"),
  signedAt: new Date("2026-07-29T01:00:00.000Z"),
  medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
  medicalReviewRequired: false,
  completedAt: new Date("2026-07-29T01:00:00.000Z"),
  integrityHash: null,
  integrityVersion: null,
  importedFromLabel: null,
  importSourceDocumentUrl: null,
  importSourceMedicalDocumentUrl: null,
  createdAt: new Date("2026-07-29T00:00:00.000Z"),
};

describe("waiver integrity", () => {
  it("detects a changed signed field", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const sealed = {
      ...record,
      integrityHash: computeWaiverIntegrityHash(record),
      integrityVersion: 1,
    };
    expect(verifyWaiverIntegrity(sealed)).toBe("valid");
    expect(verifyWaiverIntegrity({ ...sealed, templateBody: "changed" })).toBe("invalid");
    vi.unstubAllEnvs();
  });

  it("reports older records as unsealed instead of treating them as valid", () => {
    expect(verifyWaiverIntegrity(record)).toBe("unsealed");
  });
});
