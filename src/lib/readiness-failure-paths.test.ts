import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness, type ReadinessInput } from "./readiness";

/**
 * Failure paths of the boarding gate that no sibling file pins: the edges where
 * a softer answer could be read as a clearance.
 */
const now = new Date("2026-07-18T12:00:00.000Z");
const requirement = {
  requiresWaiver: true,
  requiresPayment: false,
  minimumCertificationLevel: "open_water",
  requiredSpecialties: [],
  requiresNitrox: false,
} as unknown as TripRequirement;
const signed = { status: "completed", integrityValid: true } as WaiverRecord;

function codes(input: Partial<ReadinessInput>): string[] {
  return calculateReadiness({
    timezone: "UTC",
    requirement,
    waiver: signed,
    certifications: [],
    now,
    ...input,
  }).blockers.map((blocker) => blocker.code);
}

describe("a course that finishes at this very instant", () => {
  it("is no longer ahead, so the diver is plainly missing the card", () => {
    expect(
      codes({
        certificationsInTraining: [{ level: "open_water", finishesAt: now }],
      }),
    ).toEqual(["certification_missing"]);
  });

  it("is still ahead one millisecond earlier", () => {
    expect(
      codes({
        certificationsInTraining: [
          { level: "open_water", finishesAt: new Date(now.getTime() + 1) },
        ],
      }),
    ).toEqual(["certification_in_training"]);
  });
});

describe("a rider", () => {
  const rider = { participantType: "rider" } as const;

  it("is still held by a release whose seal failed, medical bypass or not", () => {
    expect(
      codes({ ...rider, waiver: { ...signed, integrityValid: false } as WaiverRecord }),
    ).toEqual(["waiver_seal_failed"]);
  });

  it("is held by a person-level seal failure with no release handed in", () => {
    expect(codes({ ...rider, waiver: null, waiverSealFailed: true })).toEqual([
      "waiver_seal_failed",
      "waiver_not_sent",
    ]);
  });
});

describe("a lower verified card beside a higher pending one", () => {
  it("reads as pending review, never cleared", () => {
    const lower = { level: "open_water", status: "verified" } as unknown as Certification;
    const higher = {
      level: "advanced_open_water",
      status: "pending",
      identifier: "123",
    } as unknown as Certification;
    expect(
      codes({
        certifications: [lower, higher],
        requirement: {
          ...requirement,
          minimumCertificationLevel: "rescue",
        } as TripRequirement,
      }),
    ).toEqual(["certification_insufficient"]);
  });
});
