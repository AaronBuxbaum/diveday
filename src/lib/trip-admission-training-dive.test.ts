import { describe, expect, it } from "vitest";
import type { Certification, DiveSpecialty, TripRequirement } from "@/db/schema";
import { levelShort, noSpecialty } from "@/test/admission-refusals";
import {
  type CertificationLevel,
  type CertRequirementSource,
  calculateReadiness,
  type SiteCertRequirement,
} from "./readiness";
import {
  type TrainingDiveCourse,
  trainingDiveAsksNoCardForSite,
  trainingSiteAttributionKnown,
} from "./training-mark";
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

describe("trainingSiteAttributionKnown (issue #3839)", () => {
  it("names a site only for one planned dive at one site, as readiness does", () => {
    expect(trainingSiteAttributionKnown(1, 1)).toBe(true);
    expect(trainingSiteAttributionKnown(2, 1)).toBe(false);
    expect(trainingSiteAttributionKnown(1, 2)).toBe(false);
    expect(trainingSiteAttributionKnown(1, 0)).toBe(false);
    expect(trainingSiteAttributionKnown(null, 1)).toBe(false);
    expect(trainingSiteAttributionKnown(undefined, 1)).toBe(false);
  });
});

/**
 * **A default level nobody chose** (issue #3872, Aaron on #3839 2026-11-04).
 * `insertTripInstance` writes Open Water on every non-course departure and
 * flags it `minimumCertificationIsDefault`. Both gates read that level as the
 * site side of the requirement, so a training mark may lower it exactly as it
 * lowers a site's level. A level a person chose keeps standing, and an
 * unmarked seat is held to the default as before.
 */
describe("a default trip level a training mark may lower (issue #3872)", () => {
  const openWaterCourse: TrainingDiveCourse = {
    minimumLevel: null,
    certifiesLevel: "open_water",
    intro: false,
  };
  const defaultTrip = {
    ...requirement({ minimumCertificationLevel: "open_water" }),
    minimumCertificationIsDefault: true,
  };
  const chosenTrip = { ...defaultTrip, minimumCertificationIsDefault: false };
  const openWaterSite = site({ minimumCertificationLevel: "open_water" });
  // An uncertified diver the shop knows something about: the sale gate admits
  // a stranger who has said nothing (H-20260724-certification-levels-agency-rules),
  // so this one ticked nitrox on the form, which makes the level count.
  const uncertified = { evidence: evidence(), declared: { nitrox: true } };

  it("boards and sells an Open Water student marked on a one-dive charter whose only level is the default", () => {
    for (const siteRow of [openWaterSite, null]) {
      expect(
        markedLevelBlockers({
          trip: defaultTrip,
          site: siteRow,
          certifications: [],
          course: openWaterCourse,
        }),
      ).toEqual([]);
      expect(
        decideTripAdmission({
          requirement: defaultTrip,
          siteRequirement: siteRow,
          ...uncertified,
          evidence: evidence({ trainingDives: [openWaterCourse] }),
        }),
      ).toEqual({ admitted: true });
    }
  });

  it("still refuses the same student when a person chose the level", () => {
    expect(
      markedLevelBlockers({
        trip: chosenTrip,
        site: openWaterSite,
        certifications: [],
        course: openWaterCourse,
      }).map((blocker) => blocker.code),
    ).toEqual(["certification_missing"]);
    expect(
      decideTripAdmission({
        requirement: chosenTrip,
        siteRequirement: openWaterSite,
        ...uncertified,
        evidence: evidence({ trainingDives: [openWaterCourse] }),
      }),
    ).toMatchObject({ admitted: false, refusal: [{ code: "certification_missing" }] });
  });

  it("treats a requirement whose reader dropped the flag as chosen", () => {
    const { minimumCertificationIsDefault: _dropped, ...unflagged } = defaultTrip;
    expect(
      markedLevelBlockers({
        trip: unflagged,
        site: openWaterSite,
        certifications: [],
        course: openWaterCourse,
      }).map((blocker) => blocker.code),
    ).toEqual(["certification_missing"]);
  });

  it("still refuses an unmarked uncertified diver on the default", () => {
    const readiness = calculateReadiness({
      requirement: { ...defaultTrip, requiresWaiver: false } as unknown as TripRequirement,
      siteRequirement: openWaterSite,
      waiver: null,
      certifications: [],
      timezone: "UTC",
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).toContain("certification_missing");
    expect(
      decideTripAdmission({
        requirement: defaultTrip,
        siteRequirement: openWaterSite,
        ...uncertified,
      }),
    ).toMatchObject({ admitted: false, refusal: [{ code: "certification_missing" }] });
  });

  it("lowers the default no further than the course reaches, nor for an intro session", () => {
    // An Advanced course's own minimum is Open Water: the default stays asked.
    for (const course of [aow, dsd, { ...openWaterCourse, certifiesLevel: null }]) {
      expect(
        markedLevelBlockers({ trip: defaultTrip, site: null, certifications: [], course }).map(
          (blocker) => blocker.code,
        ),
        JSON.stringify(course),
      ).toEqual(["certification_missing"]);
      expect(
        decideTripAdmission({
          requirement: defaultTrip,
          siteRequirement: null,
          ...uncertified,
          evidence: evidence({ trainingDives: [course] }),
        }).admitted,
        JSON.stringify(course),
      ).toBe(false);
    }
  });

  it("lowers only the level: the trip's own specialty and nitrox gates stand", () => {
    const deepTrip = { ...defaultTrip, requiredSpecialties: ["deep"] as DiveSpecialty[] };
    expect(
      markedLevelBlockers({
        trip: deepTrip,
        site: null,
        certifications: [],
        course: openWaterCourse,
      }),
    ).toEqual([]);
    expect(
      calculateReadiness({
        requirement: { ...deepTrip, requiresWaiver: false } as unknown as TripRequirement,
        siteRequirement: null,
        waiver: null,
        certifications: [],
        timezone: "UTC",
        trainingDive: openWaterCourse,
      }).blockers.map((blocker) => blocker.code),
    ).toContain("specialty_missing");
    expect(
      decideTripAdmission({
        requirement: { ...defaultTrip, requiresNitrox: true },
        siteRequirement: null,
        evidence: evidence({ trainingDives: [openWaterCourse] }),
        declared: { level: "open_water" },
      }),
    ).toMatchObject({ admitted: false, refusal: [{ code: "nitrox_missing" }] });
  });

  it("never lets a stronger site level fall below what the course reaches", () => {
    // The default folds into an Advanced site; the Open Water course certifies
    // below it, so the site's Advanced stands.
    expect(
      markedLevelBlockers({
        trip: defaultTrip,
        site: advancedSite,
        certifications: [],
        course: openWaterCourse,
      }).map((blocker) => blocker.code),
    ).toEqual(["certification_missing"]);
  });

  it("says no card is asked only when the default is the only card asked", () => {
    expect(trainingDiveAsksNoCardForSite(defaultTrip, openWaterSite, openWaterCourse)).toBe(true);
    expect(trainingDiveAsksNoCardForSite(defaultTrip, null, openWaterCourse)).toBe(true);
    expect(trainingDiveAsksNoCardForSite(chosenTrip, openWaterSite, openWaterCourse)).toBe(false);
    expect(trainingDiveAsksNoCardForSite(defaultTrip, advancedSite, openWaterCourse)).toBe(false);
    expect(
      trainingDiveAsksNoCardForSite(
        { ...defaultTrip, requiresNitrox: true },
        openWaterSite,
        openWaterCourse,
      ),
    ).toBe(false);
    expect(trainingDiveAsksNoCardForSite(defaultTrip, openWaterSite, null)).toBe(false);
  });

  it("agrees with readiness on the level, default or chosen, for every site, card and course", () => {
    const levels: (CertificationLevel | null)[] = [null, "open_water", "advanced_open_water"];
    for (const isDefault of [true, false])
      for (const siteLevel of levels)
        for (const certifications of [[], [certification({ level: "open_water" })]])
          for (const course of [aow, openWaterCourse, dsd]) {
            const trip = { ...defaultTrip, minimumCertificationIsDefault: isDefault };
            const siteRow = siteLevel ? site({ minimumCertificationLevel: siteLevel }) : null;
            const readinessClears =
              markedLevelBlockers({ trip, site: siteRow, certifications, course }).length === 0;
            const admitted = decideTripAdmission({
              requirement: trip,
              siteRequirement: siteRow,
              evidence: evidence({ certifications, trainingDives: [course] }),
              declared: { nitrox: true },
            }).admitted;
            const label = JSON.stringify({ isDefault, siteLevel, certifications, course });
            expect(admitted, label).toBe(readinessClears);
          }
  });
});
