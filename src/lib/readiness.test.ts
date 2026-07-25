import { describe, expect, it } from "vitest";
import type {
  Certification,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import { calculateReadiness, combineCertRequirements, higherCertificationLevel } from "./readiness";

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
    ["refunded", "refunded"],
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
