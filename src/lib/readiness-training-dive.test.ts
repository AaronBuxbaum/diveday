import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness } from "./readiness";
import type { TrainingDiveCourse } from "./training-mark";

/** A marked training dive's level (issue #2731); the rest of readiness is in `readiness.test.ts`. */
const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: null,
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

const aow: TrainingDiveCourse = {
  minimumLevel: "open_water",
  certifiesLevel: "advanced_open_water",
  intro: false,
};

describe("calculateReadiness — a marked training dive's level (issue #2731)", () => {
  const openWaterCard = [certification({ level: "open_water" })];
  const base = {
    requirement,
    siteRequirement: {
      minimumCertificationLevel: "advanced_open_water" as const,
      requiredSpecialties: [],
      requiresNitrox: false,
    },
    waiver: signedWaiver,
    certifications: openWaterCard,
    timezone: "America/New_York",
    now,
  };
  const codes = (input: Parameters<typeof calculateReadiness>[0]) =>
    calculateReadiness(input).blockers.map((blocker) => blocker.code);

  it("holds the diver to the site level without one", () => {
    expect(codes(base)).toContain("certification_insufficient");
  });

  it("takes the course's own minimum in place of a level it certifies", () => {
    expect(codes({ ...base, trainingDive: aow })).toEqual([]);
  });

  it("never lowers a site's level above what the course certifies", () => {
    expect(
      codes({
        ...base,
        siteRequirement: {
          minimumCertificationLevel: "rescue",
          requiredSpecialties: [],
          requiresNitrox: false,
        },
        trainingDive: aow,
      }),
    ).toEqual(["certification_insufficient"]);
  });

  it("never removes the gate: an intro session or a course certifying nothing lowers nothing", () => {
    const dsd: TrainingDiveCourse = { minimumLevel: null, certifiesLevel: null, intro: true };
    expect(codes({ ...base, trainingDive: dsd })).toContain("certification_insufficient");
    expect(codes({ ...base, certifications: [], trainingDive: dsd })).toContain(
      "certification_missing",
    );
    expect(codes({ ...base, trainingDive: { ...aow, certifiesLevel: null } })).toContain(
      "certification_insufficient",
    );
  });

  it("still asks the course's minimum on a sighted card", () => {
    expect(
      codes({
        ...base,
        certifications: [certification({ level: "open_water", status: "pending" })],
        trainingDive: aow,
      }),
    ).toEqual(["certification_pending"]);
  });

  it("leaves a specialty and nitrox gate standing", () => {
    expect(
      codes({
        ...base,
        requirement: { ...deepRequirement, requiresNitrox: true } as TripRequirement,
        trainingDive: aow,
      }),
    ).toEqual(["specialty_missing", "nitrox_missing"]);
  });
});
