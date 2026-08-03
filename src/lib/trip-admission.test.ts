import { describe, expect, it } from "vitest";
import type {
  Certification,
  DiveSpecialty,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
} from "@/db/schema";
import {
  type CertificationLevel,
  type CertRequirementSource,
  calculateReadiness,
  type SiteCertRequirement,
} from "./readiness";
import {
  decideTripAdmission,
  decodeTripAdmissionRefusal,
  encodeTripAdmissionRefusal,
  type TripAdmissionEvidence,
  type TripAdmissionRefusal,
} from "./trip-admission";

function certification(overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "open_water",
    expiresAt: null,
    ...overrides,
  } as Certification;
}

function specialtyCard(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "deep",
    status: "verified",
    expiresAt: null,
    importedAt: null,
    reviewedAt: null,
    ...overrides,
  } as SpecialtyCertification;
}

function nitroxCard(overrides: Partial<NitroxCertification> = {}): NitroxCertification {
  return { status: "verified", ...overrides } as NitroxCertification;
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

/** The common shape: a trip that demands Advanced Open Water and nothing else. */
const advancedTrip = requirement({ minimumCertificationLevel: "advanced_open_water" });

describe("decideTripAdmission — nothing is demanded", () => {
  it("admits when neither the trip nor any site asks for a card", () => {
    expect(
      decideTripAdmission({
        requirement: requirement(),
        siteRequirement: null,
        evidence: evidence(),
      }),
    ).toEqual({ admitted: true });
  });

  it("admits when the trip has no requirement row and no site demands anything", () => {
    expect(
      decideTripAdmission({ requirement: null, siteRequirement: null, evidence: evidence() }),
    ).toEqual({ admitted: true });
  });

  it("still applies a site's own gate on a trip with no requirement row of its own", () => {
    // A missing requirements row is not "no gate" — the sites the itinerary
    // visits still demand what they demand.
    const decision = decideTripAdmission({
      requirement: null,
      siteRequirement: site({ minimumCertificationLevel: "rescue" }),
      evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
    });
    expect(decision).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: "rescue",
        missingSpecialties: [],
        nitroxRequired: false,
        heldLevel: "open_water",
      },
    });
  });
});

describe("decideTripAdmission — absence of evidence is never a refusal (H-08's settled trade-off)", () => {
  it("admits a diver this shop has never carded", () => {
    // The whole new-customer case: nothing on file, so nothing says they
    // cannot dive it. Readiness and the dock still hold that line.
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence(),
      }),
    ).toEqual({ admitted: true });
  });

  it("admits a diver whose only card is still awaiting staff verification", () => {
    // A capture in review is a card a staffer is about to adjudicate — the
    // shop has not decided anything about this diver yet.
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({
          certifications: [certification({ status: "pending", level: "open_water" })],
        }),
      }),
    ).toEqual({ admitted: true });
  });

  it("admits when the booking's identity is unconfirmed, rather than judging one human by another's cards", () => {
    // H-13: the booking reused an existing person by email under a mismatched
    // name. Those cards are evidence about somebody, but not provably about
    // the person booking — so they are not read at all.
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
        identityUnconfirmed: true,
      }),
    ).toEqual({ admitted: true });
  });
});

describe("decideTripAdmission — the ladder", () => {
  it("admits a carded diver who reaches the required level", () => {
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "advanced_open_water" })] }),
      }),
    ).toEqual({ admitted: true });
  });

  it("admits a carded diver who is above the required level", () => {
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "instructor" })] }),
      }),
    ).toEqual({ admitted: true });
  });

  it("refuses the carded diver whose highest card cannot reach the trip's level, naming what they hold", () => {
    // DOM-M6's exact harm: an Open Water diver paying in full for an
    // Advanced-only charter and finding out at the dock.
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: "advanced_open_water",
        missingSpecialties: [],
        nitroxRequired: false,
        heldLevel: "open_water",
      },
    });
  });

  it("admits on a pending card that would reach the bar, even though a verified lower one exists", () => {
    // The diver is carded (so the record is readable) but their Advanced
    // capture is in review — refusing would be refusing over a staff queue.
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({
          certifications: [
            certification({ level: "open_water" }),
            certification({ level: "advanced_open_water", status: "pending" }),
          ],
        }),
      }),
    ).toEqual({ admitted: true });
  });

  it("admits an overdue card at the required level — a refresher is not an impossibility", () => {
    // The stored date is a shop-set refresher-due date, not a card expiry
    // (glossary, C-card), and it can be cleared before the boat leaves.
    // Readiness still blocks boarding until it is.
    expect(
      decideTripAdmission({
        requirement: advancedTrip,
        siteRequirement: null,
        evidence: evidence({
          certifications: [
            certification({ level: "advanced_open_water", expiresAt: "2020-01-01" }),
            certification({ level: "open_water" }),
          ],
        }),
      }),
    ).toEqual({ admitted: true });
  });

  it("still refuses when every card — overdue or not — sits below the bar", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({ minimumCertificationLevel: "divemaster" }),
        siteRequirement: null,
        evidence: evidence({
          certifications: [
            certification({ level: "open_water", expiresAt: "2020-01-01" }),
            certification({ level: "advanced_open_water" }),
          ],
        }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: "divemaster",
        missingSpecialties: [],
        nitroxRequired: false,
        heldLevel: "advanced_open_water",
      },
    });
  });
});

describe("decideTripAdmission — specialties and nitrox", () => {
  it("refuses a carded diver with no card of the demanded specialty", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({ requiredSpecialties: ["deep"] }),
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "instructor" })] }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: null,
        missingSpecialties: ["deep"],
        nitroxRequired: false,
        // Not a ladder refusal, so no rung is named — the diver's level is
        // not what is wrong.
        heldLevel: null,
      },
    });
  });

  it("admits on a specialty card in any state — pending, imported-unconfirmed, or overdue", () => {
    const states: Array<Partial<SpecialtyCertification>> = [
      { status: "pending" },
      { importedAt: new Date("2026-01-01T00:00:00Z"), reviewedAt: null },
      { expiresAt: "2020-01-01" },
    ];
    for (const state of states) {
      expect(
        decideTripAdmission({
          requirement: requirement({ requiredSpecialties: ["deep"] }),
          siteRequirement: null,
          evidence: evidence({
            certifications: [certification({ level: "instructor" })],
            specialtyCertifications: [specialtyCard(state)],
          }),
        }),
      ).toEqual({ admitted: true });
    }
  });

  it("refuses only the specialties actually missing, and lists each one", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({ requiredSpecialties: ["deep", "wreck", "night"] }),
        siteRequirement: null,
        evidence: evidence({
          certifications: [certification({ level: "instructor" })],
          specialtyCertifications: [specialtyCard({ specialty: "wreck" })],
        }),
      }),
    ).toMatchObject({
      admitted: false,
      refusal: { missingSpecialties: ["deep", "night"] },
    });
  });

  it("refuses a nitrox-gated trip when no enriched-air card is on file at all", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({ requiresNitrox: true }),
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "instructor" })] }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: null,
        missingSpecialties: [],
        nitroxRequired: true,
        heldLevel: null,
      },
    });
  });

  it("admits on a nitrox card still awaiting verification", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({ requiresNitrox: true }),
        siteRequirement: null,
        evidence: evidence({
          certifications: [certification({ level: "instructor" })],
          nitroxCertifications: [nitroxCard({ status: "pending" })],
        }),
      }),
    ).toEqual({ admitted: true });
  });

  it("reports every unmet requirement at once, not just the first", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({
          minimumCertificationLevel: "advanced_open_water",
          requiredSpecialties: ["deep"],
          requiresNitrox: true,
        }),
        siteRequirement: null,
        evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: "advanced_open_water",
        missingSpecialties: ["deep"],
        nitroxRequired: true,
        heldLevel: "open_water",
      },
    });
  });
});

describe("decideTripAdmission — a trip that visits several sites", () => {
  /** Two sites folded into one gate, exactly as `combineSiteRequirements` does. */
  const twoSites: SiteCertRequirement = {
    minimumCertificationLevel: "advanced_open_water",
    requiredSpecialties: ["deep", "night"] as DiveSpecialty[],
    requiresNitrox: false,
  };

  it("holds a diver to the strictest level across the itinerary, not the first site's", () => {
    // Dive one is a shallow reef anyone can dive; dive two is the deep wreck.
    // A gate that only read the first site would go quiet on exactly the
    // second-tank day that needs the card.
    expect(
      decideTripAdmission({
        requirement: requirement(),
        siteRequirement: twoSites,
        evidence: evidence({
          certifications: [certification({ level: "open_water" })],
          specialtyCertifications: [
            specialtyCard({ specialty: "deep" }),
            specialtyCard({ specialty: "night" }),
          ],
        }),
      }),
    ).toMatchObject({
      admitted: false,
      refusal: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
    });
  });

  it("refuses a diver who qualifies for one site of the trip but not the other", () => {
    // Advanced with Deep: fine for the wreck, but the second dive is the night
    // dive and they hold no Night card.
    expect(
      decideTripAdmission({
        requirement: requirement(),
        siteRequirement: twoSites,
        evidence: evidence({
          certifications: [certification({ level: "advanced_open_water" })],
          specialtyCertifications: [specialtyCard({ specialty: "deep" })],
        }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: null,
        missingSpecialties: ["night"],
        nitroxRequired: false,
        heldLevel: null,
      },
    });
  });

  it("takes the stricter of the trip's own level and its sites', and the union of both specialty lists", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({
          minimumCertificationLevel: "rescue",
          requiredSpecialties: ["wreck"],
        }),
        siteRequirement: twoSites,
        evidence: evidence({
          certifications: [certification({ level: "advanced_open_water" })],
          specialtyCertifications: [specialtyCard({ specialty: "deep" })],
        }),
      }),
    ).toEqual({
      admitted: false,
      refusal: {
        requiredLevel: "rescue",
        missingSpecialties: ["wreck", "night"],
        nitroxRequired: false,
        heldLevel: "advanced_open_water",
      },
    });
  });

  it("admits the diver who clears the whole itinerary", () => {
    expect(
      decideTripAdmission({
        requirement: requirement({ requiresNitrox: true }),
        siteRequirement: twoSites,
        evidence: evidence({
          certifications: [certification({ level: "advanced_open_water" })],
          specialtyCertifications: [
            specialtyCard({ specialty: "deep" }),
            specialtyCard({ specialty: "night" }),
          ],
          nitroxCertifications: [nitroxCard()],
        }),
      }),
    ).toEqual({ admitted: true });
  });
});

describe("decideTripAdmission — a course session is admitted on the course's own rule", () => {
  /**
   * The site an AOW course actually dives: its deep adventure dive happens at a
   * site marked `advanced_open_water`, and a Deep specialty course at one that
   * also demands the Deep card it is about to issue.
   */
  const trainingSite: SiteCertRequirement = {
    minimumCertificationLevel: "advanced_open_water",
    requiredSpecialties: ["deep"] as DiveSpecialty[],
    requiresNitrox: false,
  };

  it("admits an Open Water diver enrolling in the AOW course whose site demands AOW", () => {
    // The regression this whole carve-out exists for. Without it the student
    // is refused `trip_prerequisite` by the very course that would give them
    // the card — invisibly (the trip page renders no site note on a course
    // session) and unfixably (a course session's requirements cannot be
    // edited), with detaching the dive site the only escape.
    expect(
      decideTripAdmission({
        requirement: requirement({ minimumCertificationLevel: "open_water" }),
        siteRequirement: trainingSite,
        evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
        courseSession: true,
      }),
    ).toEqual({ admitted: true });
  });

  it("refuses that same diver on the identical itinerary when it is a charter, not a course", () => {
    // The carve-out is about *which rule applies*, not a hole: the same sites
    // sold as an ordinary charter still gate at the sale.
    expect(
      decideTripAdmission({
        requirement: requirement({ minimumCertificationLevel: "open_water" }),
        siteRequirement: trainingSite,
        evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
      }),
    ).toMatchObject({
      admitted: false,
      refusal: { requiredLevel: "advanced_open_water", missingSpecialties: ["deep"] },
    });
  });

  it("admits an uncertified Discover Scuba student at a gated site", () => {
    expect(
      decideTripAdmission({
        requirement: requirement(),
        siteRequirement: trainingSite,
        evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
        courseSession: true,
      }),
    ).toEqual({ admitted: true });
  });
});

describe("the refusal survives a redirect", () => {
  const cases: TripAdmissionRefusal[] = [
    {
      requiredLevel: "advanced_open_water",
      heldLevel: "open_water",
      missingSpecialties: [],
      nitroxRequired: false,
    },
    { requiredLevel: null, heldLevel: null, missingSpecialties: ["deep"], nitroxRequired: false },
    { requiredLevel: null, heldLevel: null, missingSpecialties: [], nitroxRequired: true },
    {
      requiredLevel: "rescue",
      heldLevel: "instructor",
      missingSpecialties: ["wreck", "night", "drysuit"],
      nitroxRequired: true,
    },
  ];

  it.each(cases)("round-trips %o", (refusal) => {
    expect(decodeTripAdmissionRefusal(encodeTripAdmissionRefusal(refusal))).toEqual(refusal);
  });

  it("stays URL-safe — nothing it writes needs escaping", () => {
    for (const refusal of cases) {
      const encoded = encodeTripAdmissionRefusal(refusal);
      expect(encodeURIComponent(encoded)).toBe(encoded);
    }
  });

  const hostile: Array<[string | undefined, string]> = [
    ["", "empty"],
    [undefined, "absent"],
    ["advanced_open_water", "truncated"],
    ["advanced_open_water~open_water~deep~1~extra", "over-long"],
    ["instructor~open_water~scooter~0", "an unknown specialty"],
    ["cave~open_water~~0", "an unknown level"],
    ["advanced_open_water~open_water~~2", "a bad nitrox flag"],
    ["~~~0", "a refusal that demands nothing"],
    ["constructor~~~1", "a prototype-walking level"],
  ];

  it.each(hostile)("refuses %s (%s) rather than half-decoding it", (value) => {
    expect(decodeTripAdmissionRefusal(value)).toBeNull();
  });
});

/**
 * **Admission never refuses anyone readiness would clear.**
 *
 * The whole design rests on admission asking a strictly narrower question than
 * readiness — every gate it applies, readiness applies at least as strictly.
 * The invariant held on the day it shipped and nothing asserted it, so a later
 * tightening could violate it silently and produce the worst artifact in the
 * product: a diver refused a seat they would have been cleared to board on.
 */
describe("admission is monotone with respect to readiness", () => {
  const levels: Array<CertificationLevel | null> = [
    null,
    "open_water",
    "advanced_open_water",
    "rescue",
    "divemaster",
    "instructor",
  ];
  const specialtySets: DiveSpecialty[][] = [[], ["deep"], ["deep", "night"], ["drysuit"]];

  /** Enough shapes to exercise every branch: absent, present-but-not-clearing, clearing. */
  const evidenceCases: Array<{ name: string; evidence: TripAdmissionEvidence }> = [
    { name: "nothing on file", evidence: evidence() },
    {
      name: "one pending Open Water capture",
      evidence: evidence({
        certifications: [certification({ level: "open_water", status: "pending" })],
      }),
    },
    {
      name: "a verified Open Water card",
      evidence: evidence({ certifications: [certification({ level: "open_water" })] }),
    },
    {
      name: "a verified Instructor card and no specialty or nitrox",
      evidence: evidence({ certifications: [certification({ level: "instructor" })] }),
    },
    {
      name: "an overdue Advanced card over a verified Open Water one",
      evidence: evidence({
        certifications: [
          certification({ level: "open_water" }),
          certification({ level: "advanced_open_water", expiresAt: "2020-01-01" }),
        ],
      }),
    },
    {
      name: "every card, all verified and clean",
      evidence: evidence({
        certifications: [certification({ level: "instructor" })],
        specialtyCertifications: [
          specialtyCard({ specialty: "deep" }),
          specialtyCard({ specialty: "night" }),
          specialtyCard({ specialty: "drysuit" }),
        ],
        nitroxCertifications: [nitroxCard()],
      }),
    },
    {
      name: "specialty cards that are imported and unconfirmed",
      evidence: evidence({
        certifications: [certification({ level: "instructor" })],
        specialtyCertifications: [
          specialtyCard({
            specialty: "deep",
            importedAt: new Date("2026-01-01T00:00:00Z"),
            reviewedAt: null,
          }),
          specialtyCard({
            specialty: "night",
            importedAt: new Date("2026-01-01T00:00:00Z"),
            reviewedAt: null,
          }),
          specialtyCard({
            specialty: "drysuit",
            importedAt: new Date("2026-01-01T00:00:00Z"),
            reviewedAt: null,
          }),
        ],
        nitroxCertifications: [nitroxCard({ status: "pending" })],
      }),
    },
  ];

  it("never refuses a seat readiness would clear, across every requirement × evidence", () => {
    const now = new Date("2026-08-03T12:00:00Z");
    let refusals = 0;
    for (const level of levels) {
      for (const specialties of specialtySets) {
        for (const requiresNitrox of [false, true]) {
          for (const { name, evidence: held } of evidenceCases) {
            const source: CertRequirementSource = {
              minimumCertificationLevel: level,
              requiredSpecialties: specialties,
              requiresNitrox,
            };
            const admission = decideTripAdmission({
              requirement: source,
              siteRequirement: null,
              evidence: held,
            });
            if (admission.admitted) continue;
            refusals += 1;
            // Everything readiness needs beyond the cert gates is set to its
            // cleared state on purpose: this asserts the *certification* gates
            // alone are enough to block, not that some unrelated blocker
            // happens to be raised too.
            const readiness = calculateReadiness({
              requirement: {
                ...source,
                requiresWaiver: false,
                requiresPayment: false,
              } as TripRequirement,
              siteRequirement: null,
              waiver: null,
              certifications: held.certifications,
              specialtyCertifications: held.specialtyCertifications,
              nitroxCertifications: held.nitroxCertifications,
              now,
              timezone: "UTC",
            });
            expect(
              readiness.status,
              `admission refused (${level ?? "no level"} / ${specialties.join("+") || "no specialty"} / nitrox ${requiresNitrox}) for a diver with ${name}, but readiness cleared them`,
            ).toBe("blocked");
          }
        }
      }
    }
    // A guard on the guard: a bug that made admission admit everything would
    // otherwise leave this test passing vacuously.
    expect(refusals).toBeGreaterThan(20);
  });
});
