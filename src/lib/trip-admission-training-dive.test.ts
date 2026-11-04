import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement } from "@/db/schema";
import { levelShort, noSpecialty } from "@/test/admission-refusals";
import {
  type CertificationLevel,
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
const advancedSite = site({ minimumCertificationLevel: "advanced_open_water" });

/** Readiness's level blockers for this seat once staff mark it a training dive. */
function markedLevelBlockers(input: {
  trip: CertRequirementSource;
  site: SiteCertRequirement | null;
  certifications: readonly Certification[];
  course: TrainingDiveCourse;
}) {
  return calculateReadiness({
    requirement: { ...input.trip, requiresWaiver: false } as unknown as TripRequirement,
    siteRequirement: input.site,
    waiver: null,
    certifications: input.certifications,
    timezone: "UTC",
    trainingDive: input.course,
  }).blockers.filter((blocker) => blocker.code.startsWith("certification_"));
}

describe("decideTripAdmission — a course seat a training mark could name (issue #2731)", () => {
  const openWater = evidence({ certifications: [certification({ level: "open_water" })] });

  it("sells a site's level the course's own minimum clears, as readiness would once marked", () => {
    expect(
      decideTripAdmission({
        requirement: null,
        siteRequirement: advancedSite,
        evidence: { ...openWater, trainingDives: [aow] },
      }),
    ).toEqual({ admitted: true });
  });

  /**
   * Issue #3776: a level the trip itself sets is the shop's statement about
   * that charter, and readiness never lowers it for a marked training dive.
   * Admission did, so an Open Water diver with an Advanced course seat paid in
   * full for an Advanced-only charter and was refused at the rail.
   */
  it("refuses a level the trip itself sets, whatever course seat the diver holds", () => {
    for (const siteRequirement of [null, advancedSite]) {
      expect(
        decideTripAdmission({
          requirement: advancedTrip,
          siteRequirement,
          evidence: { ...openWater, trainingDives: [aow] },
        }),
      ).toMatchObject({
        admitted: false,
        refusal: [{ params: { requiredLevel: "advanced_open_water" } }],
      });
      expect(
        markedLevelBlockers({
          trip: advancedTrip,
          site: siteRequirement,
          certifications: openWater.certifications,
          course: aow,
        }),
      ).not.toEqual([]);
    }
  });

  it("refuses with no such course seat, above what the course certifies, or for an intro session", () => {
    expect(
      decideTripAdmission({
        requirement: null,
        siteRequirement: advancedSite,
        evidence: openWater,
      }),
    ).toMatchObject({
      admitted: false,
      refusal: [{ params: { requiredLevel: "advanced_open_water" } }],
    });
    expect(
      decideTripAdmission({
        requirement: null,
        siteRequirement: site({ minimumCertificationLevel: "rescue" }),
        evidence: { ...openWater, trainingDives: [aow] },
      }),
    ).toMatchObject({ admitted: false, refusal: [{ params: { requiredLevel: "rescue" } }] });
    // An intro session, or a course certifying nothing, sells no level at all.
    for (const course of [dsd, { ...aow, certifiesLevel: null }]) {
      expect(
        decideTripAdmission({
          requirement: null,
          siteRequirement: advancedSite,
          evidence: { ...openWater, trainingDives: [course] },
        }),
      ).toMatchObject({
        admitted: false,
        refusal: [{ params: { requiredLevel: "advanced_open_water" } }],
      });
    }
  });

  it("clears only the level: a missing Deep card is still refused", () => {
    expect(
      decideTripAdmission({
        requirement: null,
        siteRequirement: site({
          minimumCertificationLevel: "advanced_open_water",
          requiredSpecialties: ["deep"],
        }),
        evidence: { ...openWater, trainingDives: [aow] },
      }),
    ).toMatchObject({
      admitted: false,
      refusal: [noSpecialty("deep")],
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

  /**
   * The two gates on one grid (issue #3776): a trip level, a site level, the
   * diver's card and the course seat. Wherever readiness clears the level once
   * the seat is marked, admission sells it; wherever readiness still refuses
   * the level, admission refuses it too, so a mark lowers a level in both
   * gates or in neither.
   */
  it("agrees with readiness on the level, for every trip, site, card and course", () => {
    const levels: (CertificationLevel | null)[] = [
      null,
      "open_water",
      "advanced_open_water",
      "rescue",
    ];
    const rescue: TrainingDiveCourse = {
      minimumLevel: "advanced_open_water",
      certifiesLevel: "rescue",
      intro: false,
    };
    const openWaterCourse: TrainingDiveCourse = {
      minimumLevel: null,
      certifiesLevel: "open_water",
      intro: false,
    };
    for (const tripLevel of levels)
      for (const siteLevel of levels)
        for (const held of ["open_water", "advanced_open_water"] as const)
          for (const course of [aow, rescue, openWaterCourse, dsd]) {
            const trip = requirement({ minimumCertificationLevel: tripLevel });
            const siteRow = siteLevel ? site({ minimumCertificationLevel: siteLevel }) : null;
            const certifications = [certification({ level: held })];
            const readinessClears =
              markedLevelBlockers({ trip, site: siteRow, certifications, course }).length === 0;
            const admitted = decideTripAdmission({
              requirement: trip,
              siteRequirement: siteRow,
              evidence: evidence({ certifications, trainingDives: [course] }),
            }).admitted;
            const label = JSON.stringify({ tripLevel, siteLevel, held, course });
            expect(admitted, label).toBe(readinessClears);
          }
  });

  it.each(["unknown_level", "", undefined])(
    "does not let a malformed in-training level clear the requirement (%s)",
    (level) => {
      expect(
        decideTripAdmission({
          requirement: advancedTrip,
          siteRequirement: null,
          evidence: evidence({
            certifications: [certification({ level: "open_water" })],
            levelsInTraining: [level as CertificationLevel],
          }),
        }),
      ).toEqual({
        admitted: false,
        refusal: [levelShort("advanced_open_water", "open_water")],
      });
    },
  );
});
