import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { aboardBlockerKind, BLOCKER_CATEGORY, calculateReadiness } from "./readiness";

/**
 * **A release whose seal failed is not a release the boat can lean on**
 * (issue #3885). The nightly seal check writes `integrity_valid = false` when
 * a signed release no longer matches its seal: a medical "yes" turned to "no"
 * in the database after signing still reads as a clean completion, so the
 * status alone would board the diver. The verdict holds them instead, and the
 * crew stops and investigates.
 */
const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: "open_water",
  requiredSpecialties: [],
} as unknown as TripRequirement;
const noWaiverRequirement = { ...requirement, requiresWaiver: false } as TripRequirement;
const card = {
  level: "advanced_open_water",
  status: "verified",
  expiresAt: null,
} as unknown as Certification;
const signed = {
  status: "completed",
  expiresAt: new Date("2026-07-25T12:00:00.000Z"),
  integrityValid: true,
  integrityCheckedAt: new Date("2026-07-18T03:00:00.000Z"),
} as WaiverRecord;
const tampered = { ...signed, integrityValid: false } as WaiverRecord;
const unsealed = { ...signed, integrityValid: null, integrityCheckedAt: null } as WaiverRecord;

function codesFor(input: Partial<Parameters<typeof calculateReadiness>[0]>) {
  const result = calculateReadiness({
    timezone: "UTC",
    requirement,
    waiver: signed,
    certifications: [card],
    now,
    ...input,
  });
  return { status: result.status, codes: result.blockers.map((blocker) => blocker.code) };
}

describe("a signed release whose seal failed", () => {
  it("is ready while the seal holds", () => {
    expect(codesFor({ waiver: signed })).toEqual({ status: "ready", codes: [] });
  });

  it("is unchanged for a release that was never sealed", () => {
    expect(codesFor({ waiver: unsealed })).toEqual({ status: "ready", codes: [] });
  });

  it("holds a diver whose release changed after signing", () => {
    expect(codesFor({ waiver: tampered })).toEqual({
      status: "blocked",
      codes: ["waiver_seal_failed"],
    });
  });

  it("says it once, never as a release that was not sent", () => {
    const { codes } = codesFor({ waiver: tampered });
    expect(codes).not.toContain("waiver_not_sent");
    expect(codes).not.toContain("waiver_pending");
  });

  // The seal covers the medical answers, and a medical answer holds the diver
  // on every departure (H-20261006-medical-holds-every-departure): a release
  // edited from "yes" to "no" is the same doubt on a trip that asks no waiver.
  it("holds on a departure that does not ask for the waiver", () => {
    expect(codesFor({ requirement: noWaiverRequirement, waiver: tampered })).toEqual({
      status: "blocked",
      codes: ["waiver_seal_failed"],
    });
  });

  it("holds on a departure nobody has configured yet", () => {
    expect(codesFor({ requirement: null, waiver: tampered }).codes).toEqual([
      "waiver_seal_failed",
      "requirements_not_configured",
    ]);
  });

  it("holds a rider and a snorkeler as well as a diver", () => {
    for (const participantType of ["rider", "snorkeler", "diver"] as const) {
      expect(codesFor({ waiver: tampered, participantType }).codes).toContain("waiver_seal_failed");
    }
  });

  it("keeps a referral's hold beside it: both are true", () => {
    const heldAndTampered = { ...tampered, status: "medical_review" } as WaiverRecord;
    expect(codesFor({ waiver: heldAndTampered }).codes).toEqual([
      "medical_review",
      "waiver_seal_failed",
    ]);
  });

  it("is not read as a clean release because its status still says completed", () => {
    expect(tampered.status).toBe("completed");
    expect(codesFor({ waiver: tampered }).status).toBe("blocked");
  });

  it("reads as a waiver problem, and an unknown one for who is aboard", () => {
    expect(BLOCKER_CATEGORY.waiver_seal_failed).toBe("waiver");
    expect(aboardBlockerKind([{ code: "waiver_seal_failed" }])).toBe(
      aboardBlockerKind([{ code: "waiver_not_sent" }]),
    );
  });
});
