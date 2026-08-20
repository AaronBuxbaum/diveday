import { describe, expect, it } from "vitest";
import type {
  Certification,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import {
  calculateReadiness,
  combineCertRequirements,
  combineSiteRequirements,
  hasVerifiedCertificationAtLeast,
  higherCertificationLevel,
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
    expiresAt: null,
    ...overrides,
  } as Certification;
}

function specialtyCard(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "deep",
    status: "verified",
    expiresAt: null,
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
      "expired certification",
      {
        requirement,
        waiver: signedWaiver,
        certifications: [certification({ expiresAt: "2026-07-17" })],
      },
      "certification_expired",
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
    expect(calculateReadiness({ ...input, now, timezone: "UTC" }).blockers).toContainEqual(
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
      timezone: "UTC",
    }).blockers;

    expect(blockers).toContainEqual(
      expect.objectContaining({ code: "certification_self_declared" }),
    );
    expect(blockers).not.toContainEqual(expect.objectContaining({ code: "certification_pending" }));
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
      timezone: "UTC",
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
      timezone: "UTC",
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
      timezone: "UTC",
    }).blockers;

    expect(blockers).toContainEqual(expect.objectContaining({ code: "nitrox_self_declared" }));
    expect(blockers).not.toContainEqual(expect.objectContaining({ code: "nitrox_pending" }));
  });

  it("is ready only with completed waiver and a verified sufficient unexpired card", () => {
    expect(
      calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        now,
        timezone: "UTC",
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
      timezone: "UTC",
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
        timezone: "UTC",
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
      timezone: "UTC",
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
        timezone: "UTC",
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
      timezone: "UTC",
    });
    expect(result.blockers[0]?.code).toBe("identity_unconfirmed");
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "under_minimum_age" }));
  });

  it.each([
    ["missing specialty card", undefined, "specialty_missing"],
    ["pending specialty card", specialtyCard({ status: "pending" }), "specialty_pending"],
    ["expired specialty card", specialtyCard({ expiresAt: "2026-07-17" }), "specialty_expired"],
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
    // Expiry is the harder fact: an imported card that is also past its
    // refresher date reports as expired, not as one tap from cleared.
    [
      "imported specialty card that is also expired",
      specialtyCard({
        importedAt: new Date("2026-07-20T00:00:00Z"),
        reviewedAt: null,
        expiresAt: "2026-07-17",
      }),
      "specialty_expired",
    ],
  ] as const)("fails closed on a required specialty for %s", (_name, card, code) => {
    expect(
      calculateReadiness({
        requirement: deepRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: card ? [card] : [],
        now,
        timezone: "UTC",
      }).blockers,
    ).toContainEqual(expect.objectContaining({ code }));
  });

  it("is ready when a required specialty has a verified unexpired card", () => {
    expect(
      calculateReadiness({
        requirement: deepRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        specialtyCertifications: [specialtyCard()],
        now,
        timezone: "UTC",
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
        timezone: "UTC",
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
        timezone: "UTC",
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
        timezone: "UTC",
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
      timezone: "UTC",
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
      timezone: "UTC",
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
        timezone: "UTC",
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
        timezone: "UTC",
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
      timezone: "UTC",
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
        timezone: "UTC",
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
        timezone: "UTC",
      }).blockers,
    ).toContainEqual(expect.objectContaining({ code: "payment_refunded" }));
  });

  it.each(["paid", "deposit_paid", "waived"] as const)("clears payment when %s", (status) => {
    expect(
      calculateReadiness({
        requirement: paymentRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        paymentStatus: status,
        now,
        timezone: "UTC",
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("ignores payment when the trip does not require it", () => {
    expect(
      calculateReadiness({
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        paymentStatus: "unpaid",
        now,
        timezone: "UTC",
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
 * Three things have to hold at once: verified, unexpired, and at or above the
 * required rung. Anything less is evidence, not clearance.
 */
describe("hasVerifiedCertificationAtLeast", () => {
  /** The shop's local calendar date the caller measures expiry against (CR-009). */
  const todayLocal = "2026-07-18";

  it("admits a card on the exact rung the trip demands, and any rung above it", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "advanced_open_water" })],
        "advanced_open_water",
        todayLocal,
      ),
    ).toBe(true);
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "instructor" })],
        "open_water",
        todayLocal,
      ),
    ).toBe(true);
  });

  it("refuses a card below the required rung — the ladder only counts upward", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "open_water" })],
        "advanced_open_water",
        todayLocal,
      ),
    ).toBe(false);
  });

  it("refuses a pending card however senior it is — nobody has checked it yet", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ level: "instructor", status: "pending" })],
        "open_water",
        todayLocal,
      ),
    ).toBe(false);
  });

  it("refuses a verified card that lapsed before today, and keeps one expiring today", () => {
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ expiresAt: "2026-07-17" })],
        "advanced_open_water",
        todayLocal,
      ),
    ).toBe(false);
    // Valid through the end of its own local day — never hours early because
    // the shop sits in a negative UTC offset.
    expect(
      hasVerifiedCertificationAtLeast(
        [certification({ expiresAt: todayLocal })],
        "advanced_open_water",
        todayLocal,
      ),
    ).toBe(true);
  });

  it("refuses a diver with no cards at all, rather than reading an empty list as nothing to check", () => {
    expect(hasVerifiedCertificationAtLeast([], "open_water", todayLocal)).toBe(false);
  });

  it("takes the best card on file when a diver holds several", () => {
    // A lapsed AOW and a live Open Water is a real record shape; each card is
    // judged on its own, so neither one drags the other down or props it up.
    const cards = [
      certification({ level: "advanced_open_water", expiresAt: "2026-07-17" }),
      certification({ level: "open_water" }),
    ];
    expect(hasVerifiedCertificationAtLeast(cards, "open_water", todayLocal)).toBe(true);
    expect(hasVerifiedCertificationAtLeast(cards, "advanced_open_water", todayLocal)).toBe(false);
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
