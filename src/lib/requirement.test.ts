import { describe, expect, it } from "vitest";
import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
} from "@/db/schema";
import { ranksBelow } from "./interests";
import { PARTICIPANT_TYPES, type ParticipantType } from "./participant-types";
import { type CertificationLevel, calculateReadiness, combineSiteRequirements } from "./readiness";
import { buildDiverChecklist } from "./readiness-summary";
import {
  NO_REQUIREMENT,
  parseRequirement,
  type Requirement,
  requirementDemandsNothing,
  requirementOrNull,
  requirementWithin,
  serializeRequirement,
  unionRequirements,
} from "./requirement";
import { decideTripAdmission, type TripAdmissionEvidence } from "./trip-admission";
import { asksNoMoreThan } from "./worth-a-look";

/**
 * **The one Requirement shape, and every gate that reads it** (issue #2821).
 *
 * Cert gating is safety-critical, so this file does not trust the refactor that
 * routed the site, trip and readiness readers through `src/lib/requirement.ts`:
 * it holds each of them to the behaviour they had when the same three fields
 * were spelled out by hand in each. `OLD_*` below are those hand-written folds,
 * kept verbatim as oracles; the grids run every level × specialty set × nitrox
 * combination through both.
 */

const levels: Array<CertificationLevel | null> = [
  null,
  "open_water",
  "advanced_open_water",
  "rescue",
];
const specialtySets: DiveSpecialty[][] = [[], ["deep"], ["night"], ["deep", "night"]];

const ALL_REQUIREMENTS: Requirement[] = levels.flatMap((minimumCertificationLevel) =>
  specialtySets.flatMap((requiredSpecialties) =>
    [false, true].map((requiresNitrox) => ({
      minimumCertificationLevel,
      requiredSpecialties,
      requiresNitrox,
    })),
  ),
);

const RANK: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};

// ---- The hand-written folds this replaced, verbatim ----------------------

function oldHigher(a: CertificationLevel | null, b: CertificationLevel | null) {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

function oldCombine(requirement: Requirement, site: Requirement | null) {
  const specialties = new Set<DiveSpecialty>(requirement.requiredSpecialties ?? []);
  for (const specialty of site?.requiredSpecialties ?? []) specialties.add(specialty);
  return {
    minimumCertificationLevel: oldHigher(
      requirement.minimumCertificationLevel,
      site?.minimumCertificationLevel ?? null,
    ),
    requiredSpecialties: [...specialties],
    requiresNitrox: Boolean(requirement.requiresNitrox) || Boolean(site?.requiresNitrox),
  };
}

function oldEmpty(r: Requirement) {
  return !r.minimumCertificationLevel && r.requiredSpecialties.length === 0 && !r.requiresNitrox;
}

function oldAsksNoMoreThan(candidate: Requirement | null, ceiling: Requirement | null) {
  if (!candidate) return true;
  const wanted = candidate.minimumCertificationLevel;
  const held = ceiling?.minimumCertificationLevel ?? null;
  if (wanted && (!held || RANK[wanted] > RANK[held])) return false;
  if (candidate.requiresNitrox && !ceiling?.requiresNitrox) return false;
  const allowed = new Set(ceiling?.requiredSpecialties ?? []);
  return candidate.requiredSpecialties.every((specialty) => allowed.has(specialty));
}

// ---- The shape ------------------------------------------------------------

describe("Requirement", () => {
  it("asks nothing of anybody when it is absent, empty or the constant", () => {
    expect(requirementDemandsNothing(null)).toBe(true);
    expect(requirementDemandsNothing(undefined)).toBe(true);
    expect(requirementDemandsNothing(NO_REQUIREMENT)).toBe(true);
    expect(requirementOrNull(NO_REQUIREMENT)).toBeNull();
    expect(requirementOrNull(null)).toBeNull();
  });

  it("asks for something when any one of the three does", () => {
    expect(
      requirementDemandsNothing({ ...NO_REQUIREMENT, minimumCertificationLevel: "open_water" }),
    ).toBe(false);
    expect(requirementDemandsNothing({ ...NO_REQUIREMENT, requiredSpecialties: ["deep"] })).toBe(
      false,
    );
    expect(requirementDemandsNothing({ ...NO_REQUIREMENT, requiresNitrox: true })).toBe(false);
  });

  it("agrees with the hand-written emptiness test on every shape", () => {
    for (const r of ALL_REQUIREMENTS) {
      expect(requirementDemandsNothing(r), JSON.stringify(r)).toBe(oldEmpty(r));
      expect(requirementOrNull(r) === null, JSON.stringify(r)).toBe(oldEmpty(r));
    }
  });

  it("cannot be changed through the shared nothing", () => {
    expect(Object.isFrozen(NO_REQUIREMENT)).toBe(true);
    expect(Object.isFrozen(NO_REQUIREMENT.requiredSpecialties)).toBe(true);
  });
});

describe("unionRequirements", () => {
  it("is the strictest level, every specialty and any nitrox, and nothing else", () => {
    expect(
      unionRequirements(
        {
          minimumCertificationLevel: "open_water",
          requiredSpecialties: ["deep"],
          requiresNitrox: false,
        },
        {
          minimumCertificationLevel: "rescue",
          requiredSpecialties: ["night"],
          requiresNitrox: false,
        },
        { minimumCertificationLevel: null, requiredSpecialties: ["deep"], requiresNitrox: true },
      ),
    ).toEqual({
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["deep", "night"],
      requiresNitrox: true,
    });
  });

  it("demands nothing from nothing, and ignores absent parts", () => {
    expect(unionRequirements()).toEqual(NO_REQUIREMENT);
    expect(unionRequirements(null, undefined, NO_REQUIREMENT)).toEqual(NO_REQUIREMENT);
  });

  it("never loosens: a part that asks for something is always asked for", () => {
    for (const a of ALL_REQUIREMENTS) {
      for (const b of ALL_REQUIREMENTS) {
        const union = unionRequirements(a, b);
        expect(requirementWithin(a, union), `${JSON.stringify(a)} + ${JSON.stringify(b)}`).toBe(
          true,
        );
        expect(requirementWithin(b, union), `${JSON.stringify(a)} + ${JSON.stringify(b)}`).toBe(
          true,
        );
      }
    }
  });

  it("is the same fold the readiness engine always ran, for every pair", () => {
    for (const trip of ALL_REQUIREMENTS) {
      for (const site of [null, ...ALL_REQUIREMENTS]) {
        const expected = oldCombine(trip, site);
        expect(unionRequirements(trip, site), JSON.stringify({ trip, site })).toEqual(expected);
      }
    }
  });

  it("folds a trip's sites in either order to the same demand", () => {
    for (const a of ALL_REQUIREMENTS.slice(0, 12)) {
      for (const b of ALL_REQUIREMENTS.slice(5, 20)) {
        const forward = unionRequirements(a, b);
        const backward = unionRequirements(b, a);
        expect(forward.minimumCertificationLevel).toBe(backward.minimumCertificationLevel);
        expect(forward.requiresNitrox).toBe(backward.requiresNitrox);
        expect([...forward.requiredSpecialties].sort()).toEqual(
          [...backward.requiredSpecialties].sort(),
        );
      }
    }
  });

  it("keeps a site list's empty answer absent, not empty", () => {
    expect(combineSiteRequirements([])).toBeNull();
    expect(combineSiteRequirements([NO_REQUIREMENT, NO_REQUIREMENT])).toBeNull();
    expect(
      combineSiteRequirements([NO_REQUIREMENT, { ...NO_REQUIREMENT, requiresNitrox: true }]),
    ).toEqual({ ...NO_REQUIREMENT, requiresNitrox: true });
  });
});

describe("requirementWithin", () => {
  it("is the worth-a-look rule on every pair, and that rule is unchanged", () => {
    for (const candidate of [null, ...ALL_REQUIREMENTS]) {
      for (const ceiling of [null, ...ALL_REQUIREMENTS]) {
        const message = JSON.stringify({ candidate, ceiling });
        expect(requirementWithin(candidate, ceiling), message).toBe(
          oldAsksNoMoreThan(candidate, ceiling),
        );
        expect(asksNoMoreThan(candidate, ceiling), message).toBe(
          oldAsksNoMoreThan(candidate, ceiling),
        );
      }
    }
  });

  it("never points a first-timer at a boat that would refuse them at the dock", () => {
    const openWaterBoat: Requirement = {
      ...NO_REQUIREMENT,
      minimumCertificationLevel: "open_water",
    };
    expect(
      requirementWithin(
        { ...NO_REQUIREMENT, minimumCertificationLevel: "advanced_open_water" },
        openWaterBoat,
      ),
    ).toBe(false);
    expect(requirementWithin({ ...NO_REQUIREMENT, requiresNitrox: true }, openWaterBoat)).toBe(
      false,
    );
    expect(
      requirementWithin({ ...NO_REQUIREMENT, requiredSpecialties: ["deep"] }, openWaterBoat),
    ).toBe(false);
    expect(
      requirementWithin(
        { ...NO_REQUIREMENT, minimumCertificationLevel: "advanced_open_water" },
        null,
      ),
    ).toBe(false);
  });
});

describe("parseRequirement and serializeRequirement", () => {
  it("read a missing or half-missing row as asking nothing", () => {
    expect(parseRequirement(null)).toEqual(NO_REQUIREMENT);
    expect(parseRequirement(undefined)).toEqual(NO_REQUIREMENT);
    expect(parseRequirement({})).toEqual(NO_REQUIREMENT);
    expect(
      parseRequirement({
        minimumCertificationLevel: null,
        requiredSpecialties: null,
        requiresNitrox: null,
      }),
    ).toEqual(NO_REQUIREMENT);
  });

  it("keep what the row says, and copy it", () => {
    const specialties: DiveSpecialty[] = ["deep"];
    const parsed = parseRequirement({
      minimumCertificationLevel: "rescue",
      requiredSpecialties: specialties,
      requiresNitrox: true,
    });
    expect(parsed).toEqual({
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
    });
    specialties.push("night");
    expect(parsed.requiredSpecialties).toEqual(["deep"]);
  });

  it("round-trip every shape without changing what it asks", () => {
    for (const r of ALL_REQUIREMENTS) {
      expect(parseRequirement(serializeRequirement(r)), JSON.stringify(r)).toEqual(r);
    }
  });
});

// ---- The gates, with a site in the sum ------------------------------------

function certification(level: CertificationLevel, status = "verified"): Certification {
  return { status, level } as Certification;
}
function specialtyCard(specialty: DiveSpecialty): SpecialtyCertification {
  return {
    specialty,
    status: "verified",
    importedAt: null,
    reviewedAt: null,
  } as SpecialtyCertification;
}
function nitroxCard(): NitroxCertification {
  return { status: "verified" } as NitroxCertification;
}

const NOTHING: TripAdmissionEvidence = {
  certifications: [],
  specialtyCertifications: [],
  nitroxCertifications: [],
};
const OPEN_WATER_ONLY: TripAdmissionEvidence = {
  ...NOTHING,
  certifications: [certification("open_water")],
};
const PENDING_ONLY: TripAdmissionEvidence = {
  ...NOTHING,
  certifications: [certification("instructor", "pending")],
};
const EVERYTHING: TripAdmissionEvidence = {
  certifications: [certification("instructor")],
  specialtyCertifications: [
    specialtyCard("deep"),
    specialtyCard("night"),
    specialtyCard("drysuit"),
  ],
  nitroxCertifications: [nitroxCard()],
};

const NOW = new Date("2026-08-03T12:00:00Z");

function readinessBlocksOnCerts(
  trip: Requirement,
  site: Requirement | null,
  held: TripAdmissionEvidence,
  participantType?: ParticipantType,
): boolean {
  const result = calculateReadiness({
    timezone: "UTC",
    requirement: { ...trip, requiresWaiver: false, requiresPayment: false } as TripRequirement,
    siteRequirement: site,
    participantType,
    waiver: null,
    certifications: held.certifications,
    specialtyCertifications: held.specialtyCertifications,
    nitroxCertifications: held.nitroxCertifications,
    now: NOW,
  });
  return result.status === "blocked";
}

describe("every gate still refuses and clears as it did, with a site in the sum", () => {
  const sites: Array<Requirement | null> = [
    null,
    ...ALL_REQUIREMENTS.filter((_, index) => index % 5 === 0),
  ];

  /** What a carded Open Water diver with no specialty or nitrox card lacks, by the old fold. */
  function openWaterDiverLacks(trip: Requirement | null, site: Requirement | null): boolean {
    const folded = oldCombine(
      trip ?? { minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false },
      site,
    );
    return (
      (folded.minimumCertificationLevel !== null &&
        RANK[folded.minimumCertificationLevel] > RANK.open_water) ||
      folded.requiredSpecialties.length > 0 ||
      folded.requiresNitrox
    );
  }

  it("a diver nobody has carded is let through the sale blind, and never cleared at the rail", () => {
    // H-20260724-certification-levels-agency-rules: the sale-time gate fails open on absence of evidence; readiness
    // does not. The pair is the whole of the safety argument.
    for (const trip of ALL_REQUIREMENTS) {
      for (const site of sites) {
        const asks = !oldEmpty(oldCombine(trip, site));
        expect(
          decideTripAdmission({ requirement: trip, siteRequirement: site, evidence: NOTHING })
            .admitted,
          JSON.stringify({ trip, site }),
        ).toBe(true);
        expect(readinessBlocksOnCerts(trip, site, NOTHING), JSON.stringify({ trip, site })).toBe(
          asks,
        );
      }
    }
  });

  it("a carded Open Water diver is refused exactly what the trip and its sites add up to above them", () => {
    for (const trip of ALL_REQUIREMENTS) {
      for (const site of sites) {
        const lacks = openWaterDiverLacks(trip, site);
        expect(
          decideTripAdmission({
            requirement: trip,
            siteRequirement: site,
            evidence: OPEN_WATER_ONLY,
          }).admitted,
          JSON.stringify({ trip, site }),
        ).toBe(!lacks);
        expect(
          readinessBlocksOnCerts(trip, site, OPEN_WATER_ONLY),
          JSON.stringify({ trip, site }),
        ).toBe(lacks);
      }
    }
  });

  it("a diver holding every card is admitted and cleared on anything a rung up to Rescue asks", () => {
    for (const trip of ALL_REQUIREMENTS) {
      for (const site of sites) {
        const admission = decideTripAdmission({
          requirement: trip,
          siteRequirement: site,
          evidence: EVERYTHING,
        });
        expect(admission.admitted, JSON.stringify({ trip, site })).toBe(true);
        expect(readinessBlocksOnCerts(trip, site, EVERYTHING), JSON.stringify({ trip, site })).toBe(
          false,
        );
      }
    }
  });

  it("a pending card clears nothing at the rail, whatever the trip and the site ask between them", () => {
    for (const trip of ALL_REQUIREMENTS) {
      for (const site of sites) {
        const asks = !oldEmpty(oldCombine(trip, site));
        expect(
          readinessBlocksOnCerts(trip, site, PENDING_ONLY),
          JSON.stringify({ trip, site }),
        ).toBe(asks);
      }
    }
  });

  it("the stricter of a trip and a site is the one that refuses, whichever carries it", () => {
    const trip: Requirement = { ...NO_REQUIREMENT, minimumCertificationLevel: "open_water" };
    const site: Requirement = {
      ...NO_REQUIREMENT,
      minimumCertificationLevel: "advanced_open_water",
    };
    for (const [from, to] of [
      [trip, site],
      [site, trip],
    ] as const) {
      expect(
        decideTripAdmission({ requirement: from, siteRequirement: to, evidence: OPEN_WATER_ONLY })
          .admitted,
      ).toBe(false);
      expect(readinessBlocksOnCerts(from, to, OPEN_WATER_ONLY)).toBe(true);
    }
    // And a site's nitrox demand refuses a trip that never mentioned it.
    expect(
      decideTripAdmission({
        requirement: NO_REQUIREMENT,
        siteRequirement: { ...NO_REQUIREMENT, requiresNitrox: true },
        evidence: OPEN_WATER_ONLY,
      }).admitted,
    ).toBe(false);
  });

  it("admission never refuses a seat readiness would clear, across trip × site × evidence", () => {
    const held = [NOTHING, OPEN_WATER_ONLY, PENDING_ONLY, EVERYTHING];
    let refusals = 0;
    for (const trip of ALL_REQUIREMENTS) {
      for (const site of sites) {
        for (const evidence of held) {
          const admission = decideTripAdmission({
            requirement: trip,
            siteRequirement: site,
            evidence,
          });
          if (admission.admitted) continue;
          refusals += 1;
          expect(
            readinessBlocksOnCerts(trip, site, evidence),
            `admission refused ${JSON.stringify({ trip, site })} but readiness cleared the diver`,
          ).toBe(true);
        }
      }
    }
    // A guard on the guard: admitting everything would pass this vacuously.
    expect(refusals).toBeGreaterThan(100);
  });

  it("across seat kinds: a snorkeler or rider is asked for no card by either gate, and a diver by both", () => {
    const held = [NOTHING, OPEN_WATER_ONLY, EVERYTHING];
    for (const participantType of PARTICIPANT_TYPES) {
      for (const trip of ALL_REQUIREMENTS) {
        for (const site of sites) {
          for (const evidence of held) {
            const admitted = decideTripAdmission({
              requirement: trip,
              siteRequirement: site,
              evidence,
              participantType,
            }).admitted;
            const blocks = readinessBlocksOnCerts(trip, site, evidence, participantType);
            const label = JSON.stringify({ participantType, trip, site });
            if (participantType !== "diver") {
              expect(admitted, label).toBe(true);
              expect(blocks, label).toBe(false);
            } else if (!admitted) {
              expect(blocks, label).toBe(true);
            }
          }
        }
      }
    }
  });

  it("a trip with no requirement row still inherits what its sites demand", () => {
    for (const site of sites) {
      expect(
        decideTripAdmission({
          requirement: null,
          siteRequirement: site,
          evidence: OPEN_WATER_ONLY,
        }).admitted,
        JSON.stringify({ site }),
      ).toBe(!openWaterDiverLacks(null, site));
    }
  });
});

// ---- The lists and sentences that read ahead of the gates ------------------

describe("the readers that speak before the gate keep their answers", () => {
  it("the diver's checklist shows a certification step exactly when anything is asked", () => {
    for (const r of ALL_REQUIREMENTS) {
      const items = buildDiverChecklist(
        { ...r, requiresWaiver: false, requiresPayment: false } as TripRequirement,
        { status: "ready", blockers: [] },
      );
      expect(
        items.some((item) => item.category === "certification"),
        JSON.stringify(r),
      ).toBe(!oldEmpty(r));
    }
  });

  it("a diver who says they hold no card is below every departure that asks anything, and none that does not", () => {
    const uncertified = { certification: { level: null, noCertificationDeclared: true } };
    expect(ranksBelow(uncertified, null)).toBe(false);
    for (const r of ALL_REQUIREMENTS) {
      expect(ranksBelow(uncertified, r), JSON.stringify(r)).toBe(!oldEmpty(r));
    }
  });

  it("a rung is compared only against a level that is asked, never against cards", () => {
    const openWater = {
      certification: { level: "open_water" as const, noCertificationDeclared: false },
    };
    for (const r of ALL_REQUIREMENTS) {
      const below =
        r.minimumCertificationLevel !== null && RANK.open_water < RANK[r.minimumCertificationLevel];
      expect(ranksBelow(openWater, r), JSON.stringify(r)).toBe(below);
    }
  });
});
