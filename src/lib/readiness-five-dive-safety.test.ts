import { describe, expect, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness } from "./readiness";

const waiver = {
  status: "completed",
  expiresAt: new Date("2026-07-25T12:00:00.000Z"),
} as WaiverRecord;
const openWater = { status: "verified", level: "open_water" } as Certification;
const tripRequirement = {
  requiresWaiver: true,
  minimumCertificationLevel: "advanced_open_water",
  requiredSpecialties: ["deep"],
  requiresNitrox: true,
} as unknown as TripRequirement;
const advancedCourse = {
  minimumLevel: "open_water" as const,
  certifiesLevel: "advanced_open_water" as const,
  intro: false,
};

describe("the boundaries of course-site lowering", () => {
  it("never lowers the trip's own level, Deep, or nitrox requirements", () => {
    const result = calculateReadiness({
      timezone: "UTC",
      now: new Date("2026-07-18T12:00:00.000Z"),
      requirement: tripRequirement,
      siteRequirement: {
        minimumCertificationLevel: "advanced_open_water",
        requiredSpecialties: ["deep", "wreck"],
        requiresNitrox: false,
      },
      waiver,
      certifications: [openWater],
      specialtyCertifications: [],
      nitroxCertifications: [],
      trainingDive: advancedCourse,
    });
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "certification_insufficient" }),
        expect.objectContaining({ code: "specialty_missing", params: { specialty: "deep" } }),
        expect.objectContaining({ code: "specialty_missing", params: { specialty: "wreck" } }),
        expect.objectContaining({ code: "nitrox_missing" }),
      ]),
    );
  });
});
