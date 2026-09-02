import { describe, expect, it, vi } from "vitest";
import {
  computeWaiverIntegrityHash,
  isWaiverIntegrityVersion,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_ERASED,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "./waiver-integrity";

const record = {
  id: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000002",
  bookingId: null,
  personId: "00000000-0000-4000-8000-000000000003",
  templateId: "00000000-0000-4000-8000-000000000004",
  templateTitle: "Release",
  templateVersion: 1,
  templateGeneration: 1,
  templateBody: "I agree",
  status: "completed" as const,
  deliveryStatus: null,
  deliveryProviderMessageId: null,
  deliveryProviderStatus: null,
  deliveryProviderStatusAt: null,
  deliveryError: null,
  tokenHash: "token",
  tokenSealed: null,
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
  medicalClearedAt: null,
  medicalClearedByPersonId: null,
  medicalClearanceDocumentUrl: null,
  medicalClearanceEvaluatedOn: null,
  medicalClearancePhysicianName: null,
  completedAt: new Date("2026-07-29T01:00:00.000Z"),
  integrityHash: null,
  integrityVersion: null,
  importedFromLabel: null,
  importSourceDocumentUrl: null,
  importSourceMedicalDocumentUrl: null,
  anonymizedAt: null,
  anonymizedByPersonId: null,
  createdAt: new Date("2026-07-29T00:00:00.000Z"),
};

/** The same row after `anonymizeDiver` strips it — see src/db/anonymize.ts. */
const erased = {
  ...record,
  signedName: null,
  medicalAnswers: null,
  draftSignerName: null,
  draftMedicalAnswers: null,
  importedFromLabel: null,
  importSourceDocumentUrl: null,
  importSourceMedicalDocumentUrl: null,
  medicalClearanceDocumentUrl: null,
  anonymizedAt: new Date("2026-08-02T12:00:00.000Z"),
  anonymizedByPersonId: "00000000-0000-4000-8000-000000000009",
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

  it("defaults to the version-1 field set when no version is named", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    expect(computeWaiverIntegrityHash(record)).toBe(
      computeWaiverIntegrityHash(record, WAIVER_INTEGRITY_VERSION_SIGNED),
    );
    vi.unstubAllEnvs();
  });
});

describe("waiver integrity across erasure (ADR 20260802-diver-data-erasure)", () => {
  it("reads a stripped record as invalid under its original v1 seal", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    // This is the whole reason version 2 exists: the v1 field set covers
    // `signedName` and `medicalAnswers`, so erasing them breaks the seal.
    const stillClaimingV1 = {
      ...erased,
      integrityHash: computeWaiverIntegrityHash(record, WAIVER_INTEGRITY_VERSION_SIGNED),
      integrityVersion: WAIVER_INTEGRITY_VERSION_SIGNED,
    };
    expect(verifyWaiverIntegrity(stillClaimingV1)).toBe("invalid");
    vi.unstubAllEnvs();
  });

  it("verifies a re-sealed erased record as valid under v2", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const resealed = {
      ...erased,
      integrityHash: computeWaiverIntegrityHash(erased, WAIVER_INTEGRITY_VERSION_ERASED),
      integrityVersion: WAIVER_INTEGRITY_VERSION_ERASED,
    };
    expect(verifyWaiverIntegrity(resealed)).toBe("valid");
    vi.unstubAllEnvs();
  });

  it("still detects tampering with the fields that survived erasure", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const resealed = {
      ...erased,
      integrityHash: computeWaiverIntegrityHash(erased, WAIVER_INTEGRITY_VERSION_ERASED),
      integrityVersion: WAIVER_INTEGRITY_VERSION_ERASED,
    };
    for (const tampered of [
      { ...resealed, templateBody: "a different release" },
      { ...resealed, signedAt: new Date("2020-01-01T00:00:00.000Z") },
      { ...resealed, status: "pending" as const },
      { ...resealed, personId: "00000000-0000-4000-8000-0000000000ff" },
      // The erasure stamp is inside the seal, so back-dating who did it or when
      // is tampering too — not a mutable annotation beside the evidence.
      { ...resealed, anonymizedAt: new Date("2020-01-01T00:00:00.000Z") },
      { ...resealed, anonymizedByPersonId: null },
    ]) {
      expect(verifyWaiverIntegrity(tampered)).toBe("invalid");
    }
    vi.unstubAllEnvs();
  });

  it("keeps the two versions' digests apart even when the differing fields are all null", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    // An imported record can legitimately carry no signed name and no medical
    // answers, which is exactly when a v1 digest could otherwise collide with a
    // v2 one over the same row. The explicit version key rules that out.
    const bare = { ...record, signedName: null, medicalAnswers: null };
    expect(computeWaiverIntegrityHash(bare, WAIVER_INTEGRITY_VERSION_SIGNED)).not.toBe(
      computeWaiverIntegrityHash(bare, WAIVER_INTEGRITY_VERSION_ERASED),
    );
    vi.unstubAllEnvs();
  });

  it("refuses to call a record valid when it declares a version this build cannot check", () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    expect(isWaiverIntegrityVersion(3)).toBe(false);
    expect(
      verifyWaiverIntegrity({
        ...record,
        integrityHash: computeWaiverIntegrityHash(record),
        integrityVersion: 3,
      }),
    ).toBe("invalid");
    vi.unstubAllEnvs();
  });
});
