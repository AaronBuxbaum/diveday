import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness } from "./readiness";

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

describe("calculateReadiness — a snorkeler's switch to rider and back", () => {
  const refusedAt = new Date("2026-07-17T09:00:00.000Z");
  const holds = [
    ["an open referral", { status: "medical_review" }, "medical_review"],
    [
      "a physician's refusal",
      { status: "medical_review", medicalClearanceDeclinedAt: refusedAt },
      "medical_not_cleared",
    ],
  ] as const;

  /**
   * **The way aboard for a held snorkeler is a rider's seat, and it is not a
   * one-way door** (issue #2382). The same release, read as a snorkeler, a
   * rider, then a snorkeler again, must hold again: nothing about riding clears
   * the hold on the record.
   */
  it.each(holds)(
    "holds a snorkeler again after a switch to rider and back, over %s",
    (_label, overrides, code) => {
      const input = {
        timezone: "UTC",
        requirement,
        waiver: { ...signedWaiver, ...overrides } as WaiverRecord,
        certifications: [],
        now,
      };
      expect(calculateReadiness({ ...input, participantType: "snorkeler" }).blockers).toEqual([
        { code },
      ]);
      expect(calculateReadiness({ ...input, participantType: "rider" })).toEqual({
        status: "ready",
        blockers: [],
      });
      const back = calculateReadiness({ ...input, participantType: "snorkeler" });
      expect(back.status).toBe("blocked");
      expect(back.blockers).toEqual([{ code }]);
    },
  );
});
