import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness } from "./readiness";

/** A marked training dive's level (issue #2731); the rest of readiness is in `readiness.test.ts`. */
const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: "advanced_open_water",
  requiredSpecialties: [],
} as unknown as TripRequirement;
const deepRequirement = {
  ...requirement,
  requiredSpecialties: ["deep"],
} as unknown as TripRequirement;
const signedWaiver = {
  status: "completed",
  expiresAt: new Date("2026-07-25T12:00:00.000Z"),
} as WaiverRecord;

function certification(overrides: Partial<Certification> = {}): Certification {
  return { status: "verified", level: "advanced_open_water", ...overrides } as Certification;
}

describe("calculateReadiness — a marked training dive's level (issue #2731)", () => {
  const openWaterCard = [certification({ level: "open_water" })];
  const base = {
    requirement,
    waiver: signedWaiver,
    certifications: openWaterCard,
    timezone: "America/New_York",
    now,
  };
  const codes = (input: Parameters<typeof calculateReadiness>[0]) =>
    calculateReadiness(input).blockers.map((blocker) => blocker.code);

  it("holds the diver to the departure's level without one", () => {
    expect(codes(base)).toContain("certification_insufficient");
  });

  it("takes the course's own minimum in place of the departure's and its sites'", () => {
    expect(
      codes({
        ...base,
        siteRequirement: {
          minimumCertificationLevel: "rescue",
          requiredSpecialties: [],
          requiresNitrox: false,
        },
        trainingDive: { courseMinimumLevel: "open_water" },
      }),
    ).toEqual([]);
    // A course with no minimum of its own asks no level.
    expect(
      codes({ ...base, certifications: [], trainingDive: { courseMinimumLevel: null } }),
    ).toEqual([]);
  });

  it("still asks the course's minimum on a sighted card", () => {
    expect(
      codes({
        ...base,
        certifications: [certification({ level: "open_water", status: "pending" })],
        trainingDive: { courseMinimumLevel: "open_water" },
      }),
    ).toEqual(["certification_pending"]);
  });

  it("leaves a specialty and nitrox gate standing", () => {
    expect(
      codes({
        ...base,
        requirement: { ...deepRequirement, requiresNitrox: true } as TripRequirement,
        trainingDive: { courseMinimumLevel: "open_water" },
      }),
    ).toEqual(["specialty_missing", "nitrox_missing"]);
  });
});
