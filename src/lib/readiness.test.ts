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
        certifications: [certification({ expiresAt: new Date("2026-07-17") })],
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
    expect(calculateReadiness({ ...input, now }).blockers).toContainEqual(
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
      }),
    ).toEqual({
      status: "ready",
      blockers: [],
    });
  });

  it.each([
    ["missing specialty card", undefined, "specialty_missing"],
    ["pending specialty card", specialtyCard({ status: "pending" }), "specialty_pending"],
    ["rejected specialty card", specialtyCard({ status: "rejected" }), "specialty_rejected"],
    [
      "expired specialty card",
      specialtyCard({ expiresAt: new Date("2026-07-17") }),
      "specialty_expired",
    ],
    ["wrong-specialty card", specialtyCard({ specialty: "wreck" }), "specialty_missing"],
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

  it("is ready when a required specialty has a verified unexpired card", () => {
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
    ["rejected nitrox card", nitroxCard({ status: "rejected" }), "nitrox_rejected"],
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
    ["refunded", "refunded"],
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

  it.each(["paid", "deposit_paid", "waived"] as const)("clears payment when %s", (status) => {
    expect(
      calculateReadiness({
        requirement: paymentRequirement,
        waiver: signedWaiver,
        certifications: [certification()],
        paymentStatus: status,
        now,
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
