import { describe, expect, it } from "vitest";
import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  SpecialtyCertification,
} from "@/db/schema";
import {
  type CertificationLevel,
  type StandingEvidence,
  standing,
  validVerifiedCertification,
} from "./readiness";

const NOW = new Date("2026-06-01T12:00:00Z");
const LEVELS: CertificationLevel[] = [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
];

function card(over: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "open_water",
    deletedAt: null,
    selfDeclaredAt: null,
    identifier: "N1",
    ...over,
  } as Certification;
}
const specialty = (over: Partial<SpecialtyCertification> = {}) =>
  ({
    specialty: "deep",
    status: "verified",
    importedAt: null,
    reviewedAt: null,
    ...over,
  }) as SpecialtyCertification;
const nitrox = (over: Partial<NitroxCertification> = {}) =>
  ({ status: "verified", ...over }) as NitroxCertification;

const demand = (over: Partial<Parameters<typeof standing>[0]> = {}) => ({
  minimumCertificationLevel: null,
  requiredSpecialties: [] as DiveSpecialty[],
  requiresNitrox: false,
  ...over,
});

function at(evidence: Partial<StandingEvidence>, d: Parameters<typeof standing>[0]) {
  const full: StandingEvidence = {
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
    now: NOW,
    ...evidence,
  };
  return {
    verified: standing(d, full, "verified").map((b) => b.code),
    sale: standing(d, full, "sale").map((b) => b.code),
  };
}

describe("standing: the sale threshold is never stricter than verified", () => {
  const statuses = ["verified", "pending"] as const;
  const cards: Certification[][] = [[]];
  for (const level of LEVELS) {
    for (const status of statuses) {
      for (const selfDeclaredAt of [null, new Date("2026-05-01T00:00:00Z")]) {
        for (const identifier of ["N1", null]) {
          cards.push([card({ level, status, selfDeclaredAt, identifier })]);
        }
      }
    }
  }
  const specialtyRows: SpecialtyCertification[][] = [
    [],
    [specialty()],
    [specialty({ status: "pending" })],
    [specialty({ importedAt: NOW })],
    [specialty({ importedAt: NOW, reviewedAt: NOW })],
    [specialty({ specialty: "wreck" })],
  ];
  const nitroxRows: NitroxCertification[][] = [[], [nitrox()], [nitrox({ status: "pending" })], []];

  it("clears at sale whenever it clears at verified, over every demand x evidence", () => {
    let checked = 0;
    for (const required of [null, ...LEVELS]) {
      for (const requiredSpecialties of [[], ["deep"]] as DiveSpecialty[][]) {
        for (const requiresNitrox of [false, true]) {
          const d = demand({
            minimumCertificationLevel: required,
            requiredSpecialties,
            requiresNitrox,
          });
          for (const certifications of cards) {
            for (const specialtyCertifications of specialtyRows) {
              for (const nitroxCertifications of nitroxRows) {
                const got = at(
                  { certifications, specialtyCertifications, nitroxCertifications },
                  d,
                );
                checked++;
                if (got.verified.length === 0) expect(got.sale).toEqual([]);
                // Every sale blocker is also a verified blocker of the same kind.
                expect(got.sale.length).toBeLessThanOrEqual(got.verified.length);
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("holds when the booker types a rung, ticks nitrox or is booked on a course", () => {
    const d = demand({ minimumCertificationLevel: "rescue", requiresNitrox: true });
    for (const certifications of cards) {
      for (const declaredLevel of [null, ...LEVELS]) {
        for (const levelsInTraining of [[], ["rescue"]] as CertificationLevel[][]) {
          const got = at(
            {
              certifications,
              declaredLevel,
              declaredNitrox: true,
              levelsInTraining,
              certificationsInTraining: levelsInTraining.map((level) => ({
                level,
                finishesAt: new Date("2026-07-01T00:00:00Z"),
              })),
            },
            d,
          );
          if (got.verified.length === 0) expect(got.sale).toEqual([]);
        }
      }
    }
  });

  it("agrees with the verified rung: a valid verified card at the level clears both", () => {
    for (const level of LEVELS) {
      const held = card({ level });
      expect(validVerifiedCertification(held)).toBe(true);
      const got = at({ certifications: [held] }, demand({ minimumCertificationLevel: level }));
      expect(got).toEqual({ verified: [], sale: [] });
    }
  });
});

describe("standing: where the two thresholds differ, and only there", () => {
  const advanced = demand({ minimumCertificationLevel: "advanced_open_water" });

  it("sells to a pending card at the level, but does not board it", () => {
    expect(
      at({ certifications: [card({ level: "rescue", status: "pending" })] }, advanced),
    ).toEqual({
      verified: ["certification_pending"],
      sale: [],
    });
  });

  it("refuses a rung below the level at both, naming what is held", () => {
    const evidence = { certifications: [card({ level: "open_water" })] };
    const blockers = standing(
      advanced,
      { ...evidence, specialtyCertifications: [], nitroxCertifications: [], now: NOW },
      "sale",
    );
    expect(blockers).toEqual([
      {
        code: "certification_insufficient",
        params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
      },
    ]);
    expect(at(evidence, advanced).verified).toEqual(["certification_insufficient"]);
  });

  it("keeps a submitted lower card on file while naming every unmet Deep Wreck requirement", () => {
    const evidence = {
      certifications: [
        card({ status: "pending", selfDeclaredAt: NOW, identifier: "DEMO-AUDIT-NOT-REAL" }),
      ],
      specialtyCertifications: [],
      nitroxCertifications: [],
      now: NOW,
    };
    expect(
      standing(
        demand({
          minimumCertificationLevel: "advanced_open_water",
          requiredSpecialties: ["deep"],
          requiresNitrox: true,
        }),
        evidence,
        "verified",
      ),
    ).toEqual([
      {
        code: "certification_insufficient",
        params: {
          requiredLevel: "advanced_open_water",
          heldLevel: "open_water",
          heldUnverified: true,
        },
      },
      { code: "specialty_missing", params: { specialty: "deep" } },
      { code: "nitrox_missing" },
    ]);
    expect(at(evidence, advanced).verified).toEqual(["certification_insufficient"]);
    expect(at({ certifications: [] }, advanced).verified).toEqual(["certification_missing"]);
  });

  it("does not let a self-declared lower rung or a lower course clear the sale", () => {
    expect(at({ declaredLevel: "open_water" }, advanced).sale).toEqual([
      "certification_insufficient",
    ]);
    expect(at({ levelsInTraining: ["open_water"] }, advanced).sale).toEqual([
      "certification_missing",
    ]);
  });

  it("clears the sale on a typed rung or a course that gets them there, never boarding", () => {
    expect(at({ declaredLevel: "advanced_open_water" }, advanced)).toEqual({
      verified: ["certification_missing"],
      sale: [],
    });
    const course = { level: "advanced_open_water" as const, finishesAt: new Date("2026-07-01") };
    expect(
      at(
        { levelsInTraining: ["advanced_open_water"], certificationsInTraining: [course] },
        advanced,
      ),
    ).toEqual({ verified: ["certification_in_training"], sale: [] });
  });

  it("asks a specialty and nitrox for a card of any state at the sale", () => {
    const d = demand({ requiredSpecialties: ["deep"], requiresNitrox: true });
    expect(
      at(
        {
          specialtyCertifications: [specialty({ importedAt: NOW })],
          nitroxCertifications: [nitrox({ status: "pending" })],
        },
        d,
      ),
    ).toEqual({ verified: ["specialty_import_unconfirmed", "nitrox_pending"], sale: [] });
    expect(at({ specialtyCertifications: [specialty({ specialty: "wreck" })] }, d).sale).toEqual([
      "specialty_missing",
      "nitrox_missing",
    ]);
    expect(at({ declaredNitrox: true }, demand({ requiresNitrox: true })).sale).toEqual([]);
  });

  it("lists level, then specialties, then nitrox", () => {
    const d = demand({
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["deep", "wreck"],
      requiresNitrox: true,
    });
    expect(at({}, d).sale).toEqual([
      "certification_missing",
      "specialty_missing",
      "specialty_missing",
      "nitrox_missing",
    ]);
  });
});
