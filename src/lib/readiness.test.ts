import { describe, expect, it } from "vitest";
import type {
  Certification,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import type { ReadinessBlockerCode } from "./readiness";
import {
  aboardBlockerKind,
  BLOCKER_CATEGORY,
  calculateReadiness,
  certificationRank,
  combineCertRequirements,
  combineSiteRequirements,
  groupAboardBlockers,
  hasVerifiedCertificationAtLeast,
  higherCertificationLevel,
  REQUIRABLE_CERTIFICATION_LEVELS,
  unreviewedCardState,
} from "./readiness";

const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: "advanced_open_water",
  requiredSpecialties: [],
} as unknown as TripRequirement;
const signedWaiver = {
  status: "completed",
  expiresAt: new Date("2026-07-25T12:00:00.000Z"),
} as WaiverRecord;

function certification(overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "advanced_open_water",
    ...overrides,
  } as Certification;
}

function specialtyCard(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "deep",
    status: "verified",
    ...overrides,
  } as SpecialtyCertification;
}

function nitroxCard(overrides: Partial<NitroxCertification> = {}): NitroxCertification {
  return { status: "verified", ...overrides } as NitroxCertification;
}

/** A trip requirement that also demands a Deep specialty card. */
const deepRequirement = {
  ...requirement,
  requiredSpecialties: ["deep"],
} as unknown as TripRequirement;

/** A trip requirement that demands a verified nitrox card to board. */
const nitroxRequirement = {
  ...requirement,
  requiresNitrox: true,
} as unknown as TripRequirement;

/** A trip requirement that demands payment to board. */
const paymentRequirement = {
  ...requirement,
  requiresPayment: true,
} as unknown as TripRequirement;

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

  /**
   * **A claim is not a verified certification record, and the diver must be told so.**
   *
   * A self-declaration is `pending`, so it fell into the `certification_pending`
   * branch — which tells the diver on `/ready` *"your certification details are with
   * the shop for verification"* about details the shop has never verified, and (via
   * `CERT_ENTRY_CODES`, which excludes `pending` to avoid a duplicate the unique
   * index would refuse) simultaneously withdrew the form that was their only way
   * to send them. There is no number on a self-declared row, so there was never a
   * duplicate to avoid. A diver who ticked a dropdown was left with no move and
   * arrived at the dock without a verified certification.
   *
   * The gate itself never moved — both codes are blockers — which is exactly why
   * this had to be tested rather than noticed.
   */
  it("does not tell a diver their self-declared level is certification awaiting verification", () => {
    const blockers = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [
        certification({
          status: "pending",
          level: "instructor",
          selfDeclaredAt: new Date("2026-07-17T00:00:00.000Z"),
        }),
      ],
      now,
    }).blockers;

    expect(blockers).toContainEqual(
      expect.objectContaining({ code: "certification_self_declared" }),
    );
    expect(blockers).not.toContainEqual(expect.objectContaining({ code: "certification_pending" }));
  });

  /**
   * The other half of the rule above, and a regression: the exclusion is about
   * the **number**, not the stamp.
   *
   * When a diver types their card in on `/ready`, `saveCertificationFromReady`
   * stamps `selfDeclaredAt` — the `security-reviewer` fix that stops a staffer's
   * one-tap promote laundering a typed number into `verified`. That made the row
   * an unsighted self-declaration *carrying an identifier*, which fell to
   * `certification_self_declared` and re-offered the entry form to the diver who
   * had just filled it in. Re-typing the same number is refused by the unique
   * index, so the only move the page offered could not succeed.
   *
   * The gate does not move — both codes are blockers, and the row is still only
   * cleared by a sighting — which is again why this is a test rather than
   * something anyone would notice.
   */
  it("says 'with the shop' about a self-declared card that carries a number", () => {
    const blockers = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [
        certification({
          status: "pending",
          level: "advanced_open_water",
          identifier: "PADI-123456",
          selfDeclaredAt: new Date("2026-07-17T00:00:00.000Z"),
        }),
      ],
      now,
    }).blockers;

    expect(blockers).toContainEqual(expect.objectContaining({ code: "certification_pending" }));
    expect(blockers).not.toContainEqual(
      expect.objectContaining({ code: "certification_self_declared" }),
    );
  });

  it("still says 'with the shop' once a real card is captured beside the claim", () => {
    const blockers = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [
        certification({
          status: "pending",
          level: "instructor",
          selfDeclaredAt: new Date("2026-07-17T00:00:00.000Z"),
        }),
        certification({ status: "pending", level: "advanced_open_water" }),
      ],
      now,
    }).blockers;

    // The staff-captured row is the stronger fact and wins the sentence.
    expect(blockers).toContainEqual(expect.objectContaining({ code: "certification_pending" }));
  });

  it("prefers the level the shop has evidence for over a claim", () => {
    const blockers = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [
        certification({ level: "open_water" }),
        certification({
          status: "pending",
          level: "instructor",
          selfDeclaredAt: new Date("2026-07-17T00:00:00.000Z"),
        }),
      ],
      now,
    }).blockers;

    expect(blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );
  });

  it("does not tell a diver their nitrox tick is a card awaiting verification", () => {
    const blockers = calculateReadiness({
      requirement: nitroxRequirement,
      waiver: signedWaiver,
      certifications: [certification()],
      nitroxCertifications: [
        nitroxCard({ status: "pending", selfDeclaredAt: new Date("2026-07-17T00:00:00.000Z") }),
      ],
      now,
    }).blockers;

    expect(blockers).toContainEqual(expect.objectContaining({ code: "nitrox_self_declared" }));
    expect(blockers).not.toContainEqual(expect.objectContaining({ code: "nitrox_pending" }));
  });

  it("is ready only with a completed waiver and a verified card at or above the bar", () => {
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

  it("blocks a diver whose booking reused an existing person under a mismatched name (H-13)", () => {
    // Every piece of evidence is satisfied — the only thing wrong is that this
    // booking may be a different human sharing the email. It must not read ready.
    const result = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [certification()],
      identityUnconfirmed: true,
      now,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "identity_unconfirmed" }),
    );
  });

  it("does not raise the identity blocker once the booking is confirmed (or was never flagged)", () => {
    for (const identityUnconfirmed of [false, undefined]) {
      const result = calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        identityUnconfirmed,
        now,
      });
      expect(result.status).toBe("ready");
      expect(result.blockers).toEqual([]);
    }
  });

  it("raises under_minimum_age for a diver under the course's minimum on the course date (H-08)", () => {
    const result = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [certification()],
      courseMinimumAge: 15,
      dateOfBirth: "2012-03-01",
      courseDate: "2026-08-15", // 14 on this date — under 15
      now,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "under_minimum_age" }));
  });

  it("fails open on a missing date of birth or minimum age (H-08, option B)", () => {
    for (const input of [
      { courseMinimumAge: 15, dateOfBirth: undefined, courseDate: "2026-08-15" },
      { courseMinimumAge: undefined, dateOfBirth: "2012-03-01", courseDate: "2026-08-15" },
      { courseMinimumAge: 15, dateOfBirth: "2012-03-01", courseDate: undefined },
    ]) {
      const result = calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        ...input,
        now,
      });
      expect(result.status).toBe("ready");
    }
  });

  // H-22 (docs/architecture/decisions/20260725-checklist-age-disclosure.md):
  // the diver-facing checklist only names the specific age-gate reason when
  // no identity mismatch is also flagged, and it relies on this exact push
  // order — identity_unconfirmed always sorting before under_minimum_age —
  // rather than re-deriving it. `readiness-summary.test.ts` proves the
  // *picking* logic against a hand-built blocker array; this proves the real
  // engine actually produces that order, so a future reordering of the two
  // `blockers.push()` calls below would fail here rather than silently
  // flipping which line a diver sees.
  it("always raises identity_unconfirmed before under_minimum_age when both apply", () => {
    const result = calculateReadiness({
      requirement,
      waiver: signedWaiver,
      certifications: [certification()],
      identityUnconfirmed: true,
      courseMinimumAge: 15,
      dateOfBirth: "2012-03-01",
      courseDate: "2026-08-15",
      now,
    });
    expect(result.blockers[0]?.code).toBe("identity_unconfirmed");
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "under_minimum_age" }));
  });

  it.each([
    ["missing specialty card", undefined, "specialty_missing"],
    ["pending specialty card", specialtyCard({ status: "pending" }), "specialty_pending"],
    ["wrong-specialty card", specialtyCard({ specialty: "wreck" }), "specialty_missing"],
    // A specialty authorizes a riskier dive, so a migrated card holds the gate
    // until a staffer confirms it (ADR 20260725-import-specialty-cards) — this
    // is the one place a specialty is stricter than a ladder card, which clears
    // on `verified` alone.
    [
      "imported specialty card nobody has confirmed",
      specialtyCard({ importedAt: new Date("2026-07-20T00:00:00Z"), reviewedAt: null }),
      "specialty_import_unconfirmed",
    ],
    // A `pending` card is a staff capture awaiting review, not an import
    // awaiting a confirm — even if it somehow also carries import provenance.
    [
      "imported specialty card still pending review",
      specialtyCard({
        status: "pending",
        importedAt: new Date("2026-07-20T00:00:00Z"),
        reviewedAt: null,
      }),
      "specialty_pending",
    ],
  ] as const)("fails closed on a required specialty for %s", (_name, card, code) => {
    expect(
      calculateReadiness({
        requirement: deepRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: card ? [card] : [],
        now,
      }).blockers,
    ).toContainEqual(expect.objectContaining({ code }));
  });

  it("is ready when a required specialty has a verified card", () => {
    expect(
      calculateReadiness({
        requirement: deepRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: [specialtyCard()],
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("clears a required specialty once a staffer confirms the imported card", () => {
    expect(
      calculateReadiness({
        requirement: deepRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: [
          specialtyCard({
            importedAt: new Date("2026-07-20T00:00:00Z"),
            reviewedAt: new Date("2026-07-21T00:00:00Z"),
          }),
        ],
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("still clears on a hand-entered verified card, which never needed confirming", () => {
    // Guards the shape of the imported check: `importedAt` null must not be
    // read as "unconfirmed" for every card a staffer typed in themselves.
    expect(
      calculateReadiness({
        requirement: deepRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: [specialtyCard({ importedAt: null, reviewedAt: null })],
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("does not let an unconfirmed imported specialty card gate an unrelated trip", () => {
    // The hold is on the specialty requirement, never on boarding: a trip that
    // asks for no specialty is unaffected by a card sitting unconfirmed.
    expect(
      calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: [
          specialtyCard({ importedAt: new Date("2026-07-20T00:00:00Z"), reviewedAt: null }),
        ],
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("composes the stricter site level over a lax trip level", () => {
    const result = calculateReadiness({
      requirement: { ...requirement, minimumCertificationLevel: "open_water" } as TripRequirement,
      siteRequirement: {
        minimumCertificationLevel: "rescue",
        requiredSpecialties: [],
        requiresNitrox: false,
      },
      waiver: signedWaiver,
      certifications: [certification({ level: "advanced_open_water" })],
      now,
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: "certification_insufficient" }),
    );
  });

  it("unions a site-only specialty the trip did not list", () => {
    const result = calculateReadiness({
      requirement,
      siteRequirement: {
        minimumCertificationLevel: null,
        requiredSpecialties: ["wreck"],
        requiresNitrox: false,
      },
      waiver: signedWaiver,
      certifications: [certification()],
      specialtyCertifications: [],
      now,
    });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "specialty_missing" }));
  });

  it.each([
    ["missing nitrox card", undefined, "nitrox_missing"],
    ["pending nitrox card", nitroxCard({ status: "pending" }), "nitrox_pending"],
  ] as const)("fails closed on a required nitrox card for %s", (_name, card, code) => {
    expect(
      calculateReadiness({
        requirement: nitroxRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        nitroxCertifications: card ? [card] : [],
        now,
      }).blockers,
    ).toContainEqual(expect.objectContaining({ code }));
  });

  it("is ready when a required nitrox card is verified", () => {
    expect(
      calculateReadiness({
        requirement: nitroxRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        nitroxCertifications: [nitroxCard()],
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("requires nitrox when only the site demands it", () => {
    const result = calculateReadiness({
      requirement,
      siteRequirement: {
        minimumCertificationLevel: null,
        requiredSpecialties: [],
        requiresNitrox: true,
      },
      waiver: signedWaiver,
      certifications: [certification()],
      nitroxCertifications: [],
      now,
    });
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "nitrox_missing" }));
  });

  it.each([
    ["unpaid", "unpaid"],
    ["absent payment", undefined],
  ] as const)("blocks payment for %s when the trip requires it", (_name, status) => {
    expect(
      calculateReadiness({
        requirement: paymentRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        paymentStatus: status,
        now,
      }).blockers,
    ).toContainEqual(expect.objectContaining({ code: "payment_due" }));
  });

  it("blocks payment as refunded, distinct from an outstanding balance, when the trip requires it", () => {
    expect(
      calculateReadiness({
        requirement: paymentRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        paymentStatus: "refunded",
        now,
      }).blockers,
    ).toContainEqual(expect.objectContaining({ code: "payment_refunded" }));
  });

  /**
   * `partly_refunded` is in here deliberately, and it is the case worth
   * stating out loud: the commonest partial refund there is happens *after*
   * weather cuts a boat short, and the second commonest hands back a fare
   * while keeping a non-refundable fee. Either way the shop is still holding
   * real money against that seat, exactly as with `deposit_paid`. Had the new
   * status been added to the column without being added here, every diver a
   * shop showed that kindness to would have turned up blocked at the next
   * roll call (issue #699).
   */
  it.each(["paid", "deposit_paid", "partly_refunded", "waived"] as const)(
    "clears payment when %s",
    (status) => {
      expect(
        calculateReadiness({
          requirement: paymentRequirement,
          waiver: signedWaiver,
          certifications: [certification()],
          paymentStatus: status,
          now,
        }),
      ).toEqual({ status: "ready", blockers: [] });
    },
  );

  it("ignores payment when the trip does not require it", () => {
    expect(
      calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        paymentStatus: "unpaid",
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });
});

/**
 * The shared clearance predicate: course admission (`createBookingRecord`,
 * src/db/bookings.ts) and final trip readiness both ask this one question, so
 * a shop can never enrol a diver its own manifest would later block. Tested
 * directly here rather than only through those two callers, because both of
 * them can refuse for half a dozen other reasons — a gate that quietly stopped
 * checking `status` would still look like it was working from the outside.
 *
 * Two things have to hold at once: verified, and at or above the required
 * rung. Anything less is evidence, not clearance.
 */
describe("hasVerifiedCertificationAtLeast", () => {
  it("admits a card on the exact rung the trip demands, and any rung above it", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "advanced_open_water" })],
        "advanced_open_water",
      ),
    ).toBe(true);
    expect(
      hasVerifiedCertificationAtLeast([certification({ level: "instructor" })], "open_water"),
    ).toBe(true);
  });

  /**
   * **The rule the dropped column used to break** (issue #630, ADR
   * 20260821-a-card-does-not-expire). A recreational certification does not
   * expire, so a card sighted in 2019 clears a 2026 departure exactly as one
   * sighted yesterday does — and this is stated positively rather than left as
   * the absence of a check, because an absence is what somebody reinstates by
   * accident on a safety surface.
   */
  it("clears on a card verified years ago — a certification does not go stale", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [
          certification({
            level: "advanced_open_water",
            reviewedAt: new Date("2019-04-02T00:00:00.000Z"),
            createdAt: new Date("2019-04-02T00:00:00.000Z"),
          }),
        ],
        "advanced_open_water",
      ),
    ).toBe(true);
  });

  it("refuses a card below the required rung — the ladder only counts upward", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "open_water" })],
        "advanced_open_water",
      ),
    ).toBe(false);
  });

  it("refuses a pending card however senior it is — nobody has checked it yet", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "instructor", status: "pending" })],
        "open_water",
      ),
    ).toBe(false);
  });

  it("refuses a diver with no cards at all, rather than reading an empty list as nothing to check", () => {
    expect(hasVerifiedCertificationAtLeast([], "open_water")).toBe(false);
  });

  it("takes the best card on file when a diver holds several", () => {
    // A pending AOW and a verified Open Water is a real record shape; each card
    // is judged on its own, so neither one drags the other down or props it up.
    const cards = [
      certification({ level: "advanced_open_water", status: "pending" }),
      certification({ level: "open_water" }),
    ];
    expect(hasVerifiedCertificationAtLeast(cards, "open_water")).toBe(true);
    expect(hasVerifiedCertificationAtLeast(cards, "advanced_open_water")).toBe(false);
  });
});

/**
 * **What a shop may demand of a paying diver, versus what a person may hold.**
 *
 * Two different sets since 2026-08-21 (issue #630). The distinction is a named
 * constant rather than a filter at the two `<select>`s, because a filter at one
 * call site is a rule the other call site does not have.
 */
describe("REQUIRABLE_CERTIFICATION_LEVELS", () => {
  it("stops at the top recreational rung", () => {
    expect([...REQUIRABLE_CERTIFICATION_LEVELS]).toEqual([
      "open_water",
      "advanced_open_water",
      "rescue",
    ]);
  });

  it("leaves the professional ratings on the ladder a diver can hold", () => {
    // Crew hold these, `course-ratios.ts` counts them, and an instructor-led
    // session is gated on one being assigned — none of which is a shop telling
    // a customer to hold a working rating to board a charter.
    const requirable = new Set<string>(REQUIRABLE_CERTIFICATION_LEVELS);
    expect(requirable.has("divemaster")).toBe(false);
    expect(requirable.has("instructor")).toBe(false);
    expect(certificationRank("divemaster")).toBeGreaterThan(certificationRank("rescue"));
    expect(certificationRank("instructor")).toBeGreaterThan(certificationRank("divemaster"));
    // And they still clear a requirement they sit above, which is the half
    // that would break silently if the enum had been narrowed instead.
    expect(
      hasVerifiedCertificationAtLeast([certification({ level: "instructor" })], "rescue"),
    ).toBe(true);
  });
});

describe("higherCertificationLevel", () => {
  it("returns the stricter level, ignoring null", () => {
    expect(higherCertificationLevel("open_water", "rescue")).toBe("rescue");
    expect(higherCertificationLevel("instructor", "open_water")).toBe("instructor");
    expect(higherCertificationLevel(null, "open_water")).toBe("open_water");
    expect(higherCertificationLevel("divemaster", null)).toBe("divemaster");
    expect(higherCertificationLevel(null, null)).toBeNull();
  });
});

describe("combineCertRequirements", () => {
  it("takes the stricter level, union of specialties, and OR of nitrox", () => {
    const combined = combineCertRequirements(
      {
        minimumCertificationLevel: "open_water",
        requiredSpecialties: ["deep"],
        requiresNitrox: false,
      } as TripRequirement,
      {
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: ["deep", "wreck"],
        requiresNitrox: true,
      },
    );
    expect(combined.minimumCertificationLevel).toBe("advanced_open_water");
    expect([...combined.requiredSpecialties].sort()).toEqual(["deep", "wreck"]);
    expect(combined.requiresNitrox).toBe(true);
  });
});

describe("combineSiteRequirements", () => {
  it("is null when the trip visits nothing, or nothing it visits demands anything", () => {
    expect(combineSiteRequirements([])).toBeNull();
    expect(
      combineSiteRequirements([
        { minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false },
        { minimumCertificationLevel: null, requiredSpecialties: [], requiresNitrox: false },
      ]),
    ).toBeNull();
  });

  it("folds every site the trip visits — strictest level, union, OR of nitrox", () => {
    // The two-tank case: dive one is the shallow reef, dive two is the deep
    // wreck. Reading only the first goes quiet on exactly the dive that needed
    // the card.
    const combined = combineSiteRequirements([
      {
        minimumCertificationLevel: "open_water",
        requiredSpecialties: ["deep"],
        requiresNitrox: false,
      },
      {
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: ["wreck"],
        requiresNitrox: true,
      },
    ]);
    expect(combined?.minimumCertificationLevel).toBe("advanced_open_water");
    expect([...(combined?.requiredSpecialties ?? [])].sort()).toEqual(["deep", "wreck"]);
    expect(combined?.requiresNitrox).toBe(true);
  });

  it("does not care which order the sites arrive in", () => {
    const a = {
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["deep"],
      requiresNitrox: true,
    } as const;
    const b = {
      minimumCertificationLevel: "open_water",
      requiredSpecialties: ["wreck"],
      requiresNitrox: false,
    } as const;
    const forward = combineSiteRequirements([a, b]);
    const backward = combineSiteRequirements([b, a]);
    expect(forward?.minimumCertificationLevel).toBe(backward?.minimumCertificationLevel);
    expect([...(forward?.requiredSpecialties ?? [])].sort()).toEqual(
      [...(backward?.requiredSpecialties ?? [])].sort(),
    );
    expect(forward?.requiresNitrox).toBe(backward?.requiresNitrox);
  });
});

/**
 * **What a blocker aboard a boat is asking of the crew.**
 *
 * `BLOCKER_CATEGORY` answers "which requirement family", which is right for a
 * checklist and wrong at the rail: once a diver is on the boat the gate is
 * behind them and the only question is what happens before *they* get in the
 * water. The card said "the fix is in the list below" to all of it (#791).
 */
describe("aboardBlockerKind", () => {
  it("calls a medical hold a medical hold, though its family is waiver", () => {
    // The distinction the whole thing turns on: `BLOCKER_CATEGORY` files
    // `medical_review` under `waiver` — correctly, that is where the answer was
    // collected — but a waiver nobody signed and a flagged medical answer are
    // opposite situations on a boat.
    expect(BLOCKER_CATEGORY.medical_review).toBe("waiver");
    expect(aboardBlockerKind([{ code: "medical_review" }])).toBe("medical");
  });

  /**
   * **The four that are not paperwork.** The first cut had one bucket for
   * everything that was neither medical nor certification, called it
   * "paperwork that is still owed", and swept these in: an unsigned waiver is
   * **no medical declaration at all**, `identity_unconfirmed` means the human
   * aboard may not be the human whose cards are on file (H-13),
   * `readiness_unavailable` is a failed lookup this module refuses to treat as
   * a pass, and `requirements_not_configured` means nobody's cards were
   * checked against anything (`dive-domain-expert`, on issue #791).
   */
  it.each([
    "waiver_not_sent",
    "waiver_pending",
    "waiver_expired",
    "identity_unconfirmed",
    "readiness_unavailable",
    "requirements_not_configured",
  ] as const)("reads %s as unknown, not as office work", (code) => {
    expect(aboardBlockerKind([{ code }])).toBe("unknown");
  });

  it.each([
    ["certification_missing", "certification"],
    ["certification_insufficient", "certification"],
    ["nitrox_missing", "certification"],
    ["specialty_pending", "certification"],
    // An agency hard stop about the diver, not the shop-side "setup" it is
    // filed under for a reason scoped to the public confirmation panel.
    ["under_minimum_age", "certification"],
    ["payment_due", "payment"],
    ["payment_refunded", "payment"],
  ] as const)("reads %s as %s", (code, kind) => {
    expect(aboardBlockerKind([{ code }])).toBe(kind);
  });

  it("says the worst one, because a line has room for one", () => {
    // A diver held on medical review *and* missing a card is a medical hold.
    expect(aboardBlockerKind([{ code: "certification_missing" }, { code: "medical_review" }])).toBe(
      "medical",
    );
    expect(aboardBlockerKind([{ code: "payment_due" }, { code: "certification_missing" }])).toBe(
      "certification",
    );
    expect(aboardBlockerKind([{ code: "payment_due" }, { code: "waiver_pending" }])).toBe(
      "unknown",
    );
  });

  it("is null for a diver with nothing against them", () => {
    expect(aboardBlockerKind([])).toBeNull();
  });

  it("classifies every blocker code, so none can fall through to payment", () => {
    // The map is exhaustive by type, but a code added with the wrong kind would
    // still compile. This pins that nothing lands in `payment` by accident —
    // the bucket that means "does not change what happens in the water".
    const paymentCodes = (Object.keys(BLOCKER_CATEGORY) as ReadinessBlockerCode[]).filter(
      (code) => aboardBlockerKind([{ code }]) === "payment",
    );
    expect(paymentCodes.sort()).toEqual(["payment_due", "payment_refunded"]);
  });
});

/**
 * **One entry per kind, never one reason over a whole count.**
 *
 * The first cut returned a single kind for the group, and the card rendered it
 * against the group's total — "5 divers are aboard — a medical hold" when one
 * of the five was. Run the other way, four divers with no medical declaration
 * vanish behind the one the crew was told about.
 */
describe("groupAboardBlockers", () => {
  const diver = (name: string, ...codes: ReadinessBlockerCode[]) => ({
    blockers: codes.map((code) => ({ code })),
    value: name,
  });

  it("splits a mixed boat into one group per kind, worst first", () => {
    expect(
      groupAboardBlockers([
        diver("Cert Gap", "certification_missing"),
        diver("Owes Money", "payment_due"),
        diver("Medical Hold", "medical_review"),
        diver("No Waiver", "waiver_pending"),
        diver("Cert Gap Two", "nitrox_missing"),
      ]),
    ).toEqual([
      { kind: "medical", members: ["Medical Hold"] },
      { kind: "unknown", members: ["No Waiver"] },
      { kind: "certification", members: ["Cert Gap", "Cert Gap Two"] },
      { kind: "payment", members: ["Owes Money"] },
    ]);
  });

  it("keeps roster order inside a group, so a named line names the right diver", () => {
    expect(
      groupAboardBlockers([
        diver("First", "certification_missing"),
        diver("Second", "certification_pending"),
      ])[0]?.members,
    ).toEqual(["First", "Second"]);
  });

  it("drops a diver with nothing against them rather than inventing a group", () => {
    expect(groupAboardBlockers([diver("Clear")])).toEqual([]);
    expect(groupAboardBlockers([])).toEqual([]);
  });
});

/**
 * The inverse of the one-tap "Mark certified", behind the undo toast that
 * replaced the "Certification marked verified" banner. Two of its three answers
 * are refusals, and the interesting one is the third.
 */
describe("unreviewedCardState", () => {
  it("returns a staff-captured card to pending and drops the review stamp", () => {
    expect(unreviewedCardState({ status: "verified", reviewedAt: now })).toEqual({
      ok: true,
      status: "pending",
    });
  });

  it("leaves an imported card verified, because the tap only confirmed it", () => {
    // An imported card is valid on arrival (ADR 20260724-import-verified-cards)
    // and the confirm is a nudge, not the thing that cleared it — so undoing
    // the confirm must not take away a certification the import established.
    expect(unreviewedCardState({ status: "verified", reviewedAt: now, importedAt: now })).toEqual({
      ok: true,
      status: "verified",
    });
  });

  it("refuses a card whose review was a sighting", () => {
    // Certifying a self-declaration or a shop-issued specialty rewrites the row
    // from the card in the staffer's hand — agency, number, and for a level
    // card the rung. Those values are gone, so a status-only revert would leave
    // a pending row wearing a sighted number with none of the marks saying a
    // diver typed it: the laundering `selfDeclaredAt` exists to prevent. Those
    // are taken back by deleting the card instead.
    expect(
      unreviewedCardState({ status: "verified", reviewedAt: now, selfDeclaredAt: now }),
    ).toEqual({ ok: false, reason: "sighted_card" });
    expect(
      unreviewedCardState({ status: "verified", reviewedAt: now, issuedByShopAt: now }),
    ).toEqual({ ok: false, reason: "sighted_card" });
  });

  it("refuses a card nobody has reviewed, so a replayed undo cannot un-verify one", () => {
    expect(unreviewedCardState({ status: "pending", reviewedAt: null })).toEqual({
      ok: false,
      reason: "not_reviewed",
    });
  });
});

/**
 * The boarding gate's half of the physician-clearance change (issue #1252).
 * `src/lib/waivers.test.ts` pins the resolution rules; this pins the only thing
 * that matters at the rail — whether the diver may board.
 */
describe("physician clearance and the medical block", () => {
  const heldNow = new Date("2026-07-24T12:00:00.000Z");

  it("still blocks a referral nobody has cleared", () => {
    const result = calculateReadiness({
      requirement,
      waiver: { ...signedWaiver, status: "medical_review" } as WaiverRecord,
      certifications: [certification()],
      now: heldNow,
    });
    expect(result.blockers).toContainEqual({ code: "medical_review" });
  });

  it("clears the block once a physician clearance is recorded", () => {
    const result = calculateReadiness({
      requirement,
      waiver: {
        ...signedWaiver,
        status: "medical_review",
        medicalClearedAt: new Date("2026-07-24T09:00:00.000Z"),
        medicalClearedByPersonId: "staff-1",
      } as WaiverRecord,
      certifications: [certification()],
      now: heldNow,
    });
    expect(result.blockers).not.toContainEqual({ code: "medical_review" });
  });

  it("fails closed on a half-written clearance — a date with nobody behind it is not a clearance", () => {
    // The database refuses this pair outright
    // (`waiver_records_medical_clearance_attributed`); the domain must not
    // depend on that being the only thing standing between a diver and the
    // boat, so the *absence of a date* is what the gate reads and a stray
    // person id alone lifts nothing.
    const result = calculateReadiness({
      requirement,
      waiver: {
        ...signedWaiver,
        status: "medical_review",
        medicalClearedAt: null,
        medicalClearedByPersonId: "staff-1",
      } as WaiverRecord,
      certifications: [certification()],
      now: heldNow,
    });
    expect(result.blockers).toContainEqual({ code: "medical_review" });
  });
});
