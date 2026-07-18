import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness } from "./readiness";

const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: "advanced_open_water",
} as TripRequirement;
const signedWaiver = {
  status: "completed",
  expiresAt: new Date("2026-07-25T12:00:00.000Z"),
} as WaiverRecord;

function certification(overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "advanced_open_water",
    expiresAt: null,
    ...overrides,
  } as Certification;
}

describe("calculateReadiness", () => {
  it.each([
    [
      "no configuration",
      { requirement: null, waiver: signedWaiver, certifications: [certification()] },
      "requirements_not_configured",
    ],
    [
      "missing waiver",
      { requirement, waiver: null, certifications: [certification()] },
      "waiver_not_sent",
    ],
    [
      "medical review",
      {
        requirement,
        waiver: { ...signedWaiver, status: "medical_review" },
        certifications: [certification()],
      },
      "medical_review",
    ],
    [
      "pending certification",
      { requirement, waiver: signedWaiver, certifications: [certification({ status: "pending" })] },
      "certification_pending",
    ],
    [
      "expired certification",
      {
        requirement,
        waiver: signedWaiver,
        certifications: [certification({ expiresAt: new Date("2026-07-17") })],
      },
      "certification_expired",
    ],
    [
      "insufficient certification",
      {
        requirement,
        waiver: signedWaiver,
        certifications: [certification({ level: "open_water" })],
      },
      "certification_insufficient",
    ],
  ] as const)("fails closed for %s", (_name, input, code) => {
    expect(calculateReadiness({ ...input, now }).blockers).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it("is ready only with completed waiver and a verified sufficient unexpired card", () => {
    expect(
      calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        now,
      }),
    ).toEqual({
      status: "ready",
      blockers: [],
    });
  });
});
