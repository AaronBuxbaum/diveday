import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement } from "@/db/schema";
import {
  type CertRequirementSource,
  calculateReadiness,
  type SiteCertRequirement,
} from "./readiness";
import { decideTripAdmission, type TripAdmissionEvidence } from "./trip-admission";

/** A course seat a training mark could name (issue #2731); the rest is in `trip-admission.test.ts`. */
function certification(overrides: Partial<Certification> = {}): Certification {
  return { status: "verified", level: "open_water", ...overrides } as Certification;
}

function evidence(overrides: Partial<TripAdmissionEvidence> = {}): TripAdmissionEvidence {
  return {
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
    ...overrides,
  };
}

function requirement(overrides: Partial<CertRequirementSource> = {}): CertRequirementSource {
  return {
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    ...overrides,
  };
}

function site(overrides: Partial<SiteCertRequirement> = {}): SiteCertRequirement {
  return requirement(overrides);
}

const advancedTrip = requirement({ minimumCertificationLevel: "advanced_open_water" });

describe("decideTripAdmission — a course seat a training mark could name (issue #2731)", () => {
  const openWater = evidence({ certifications: [certification({ level: "open_water" })] });

  it("sells the level the course's own minimum clears, as readiness would once marked", () => {
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: { ...openWater, trainingDiveLevels: ["open_water"] },
      }),
    ).toEqual({ admitted: true });
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: { ...openWater, trainingDiveLevels: [null] },
      }),
    ).toEqual({ admitted: true });
  });

  it("refuses when no such course seat exists, or its minimum is above the diver too", () => {
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: openWater,
      }),
    ).toMatchObject({ admitted: false, refusal: { requiredLevel: "advanced_open_water" } });
    expect(
      decideTripAdmission({
        requirement: requirement({ minimumCertificationLevel: "rescue" }),
        siteRequirement: null,
        evidence: { ...openWater, trainingDiveLevels: ["advanced_open_water"] },
      }),
    ).toMatchObject({ admitted: false, refusal: { requiredLevel: "rescue" } });
  });

  it("clears only the level: a missing Deep card is still refused", () => {
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: site({ requiredSpecialties: ["deep"] }),
        evidence: { ...openWater, trainingDiveLevels: ["open_water"] },
      }),
    ).toMatchObject({
      admitted: false,
      refusal: { requiredLevel: null, missingSpecialties: ["deep"] },
    });
  });

  it("never refuses a marked seat readiness clears on the course's level", () => {
    const readiness = calculateReadiness({
      requirement: { ...advancedTrip, requiresWaiver: false } as unknown as TripRequirement,
      waiver: null,
      certifications: openWater.certifications,
      timezone: "UTC",
      trainingDive: { courseMinimumLevel: "open_water" },
    });
    expect(readiness.blockers.filter((b) => b.code.startsWith("certification_"))).toEqual([]);
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: { ...openWater, trainingDiveLevels: ["open_water"] },
      }).admitted,
    ).toBe(true);
  });
});
