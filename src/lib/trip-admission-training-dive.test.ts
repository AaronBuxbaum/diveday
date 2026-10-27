import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement } from "@/db/schema";
import {
  type CertRequirementSource,
  calculateReadiness,
  type SiteCertRequirement,
} from "./readiness";
import type { TrainingDiveCourse } from "./training-mark";
import { decideTripAdmission, type TripAdmissionEvidence } from "./trip-admission";

const aow: TrainingDiveCourse = {
  minimumLevel: "open_water",
  certifiesLevel: "advanced_open_water",
  intro: false,
};
const dsd: TrainingDiveCourse = { minimumLevel: null, certifiesLevel: null, intro: true };

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
        evidence: { ...openWater, trainingDives: [aow] },
      }),
    ).toEqual({ admitted: true });
  });

  it("refuses with no such course seat, above what the course certifies, or for an intro session", () => {
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
        evidence: { ...openWater, trainingDives: [aow] },
      }),
    ).toMatchObject({ admitted: false, refusal: { requiredLevel: "rescue" } });
    // An intro session, or a course certifying nothing, sells no level at all.
    for (const course of [dsd, { ...aow, certifiesLevel: null }]) {
      expect(
        decideTripAdmission({
          requirement: advancedTrip,
          siteRequirement: null,
          evidence: { ...openWater, trainingDives: [course] },
        }),
      ).toMatchObject({ admitted: false, refusal: { requiredLevel: "advanced_open_water" } });
    }
  });

  it("clears only the level: a missing Deep card is still refused", () => {
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: site({ requiredSpecialties: ["deep"] }),
        evidence: { ...openWater, trainingDives: [aow] },
      }),
    ).toMatchObject({
      admitted: false,
      refusal: { requiredLevel: null, missingSpecialties: ["deep"] },
    });
  });

  it("never refuses a marked seat readiness clears on the course's level", () => {
    const readiness = calculateReadiness({
      requirement: { ...requirement(), requiresWaiver: false } as unknown as TripRequirement,
      siteRequirement: site({ minimumCertificationLevel: "advanced_open_water" }),
      waiver: null,
      certifications: openWater.certifications,
      timezone: "UTC",
      trainingDive: aow,
    });
    expect(readiness.blockers.filter((b) => b.code.startsWith("certification_"))).toEqual([]);
    expect(
      decideTripAdmission({
        requirement: requirement(),
        siteRequirement: site({ minimumCertificationLevel: "advanced_open_water" }),
        evidence: { ...openWater, trainingDives: [aow] },
      }).admitted,
    ).toBe(true);
  });
});
