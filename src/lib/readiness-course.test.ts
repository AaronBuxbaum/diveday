import { describe, expect, it } from "vitest";
import type {
  Certification,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
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

function certification(overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "advanced_open_water",
    ...overrides,
  } as Certification;
}

function _specialtyCard(overrides: Partial<SpecialtyCertification> = {}): SpecialtyCertification {
  return {
    specialty: "deep",
    status: "verified",
    ...overrides,
  } as SpecialtyCertification;
}

function _nitroxCard(overrides: Partial<NitroxCertification> = {}): NitroxCertification {
  return { status: "verified", ...overrides } as NitroxCertification;
}

/** A trip requirement that also demands a Deep specialty card. */
const _deepRequirement = {
  ...requirement,
  requiredSpecialties: ["deep"],
} as unknown as TripRequirement;

/** A trip requirement that demands a verified nitrox card to board. */
const _nitroxRequirement = {
  ...requirement,
  requiresNitrox: true,
} as unknown as TripRequirement;

/** A trip requirement that demands payment to board. */
const _paymentRequirement = {
  ...requirement,
  requiresPayment: true,
} as unknown as TripRequirement;

describe("calculateReadiness — a course that gets them there", () => {
  const tomorrow = new Date("2026-07-19T16:00:00.000Z");
  const yesterday = new Date("2026-07-17T16:00:00.000Z");

  function certificationBlockers(
    certifications: Certification[],
    certificationsInTraining: { level: Certification["level"]; finishesAt: Date }[],
  ) {
    return calculateReadiness({
      timezone: "UTC",
      requirement,
      waiver: signedWaiver,
      certifications,
      certificationsInTraining,
      now,
    }).blockers.filter((blocker) => blocker.code.startsWith("certification"));
  }

  it("names the level a booked course will reach, and still blocks", () => {
    const result = calculateReadiness({
      timezone: "UTC",
      requirement,
      waiver: signedWaiver,
      certifications: [certification({ level: "open_water" })],
      certificationsInTraining: [{ level: "advanced_open_water", finishesAt: tomorrow }],
      now,
    });
    // Boarding still waits for the card: enrollment never clears a gate.
    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      { code: "certification_in_training", params: { requiredLevel: "advanced_open_water" } },
    ]);
  });

  it("covers a diver with no card at all, booked on the course", () => {
    expect(
      certificationBlockers([], [{ level: "advanced_open_water", finishesAt: tomorrow }]),
    ).toEqual([expect.objectContaining({ code: "certification_in_training" })]);
  });

  it("counts a course that certifies above the trip's level", () => {
    expect(certificationBlockers([], [{ level: "rescue", finishesAt: tomorrow }])).toEqual([
      expect.objectContaining({ code: "certification_in_training" }),
    ]);
  });

  it("does not count a course that stops short of the trip's level", () => {
    expect(
      certificationBlockers(
        [certification({ level: "open_water" })],
        [{ level: "open_water", finishesAt: tomorrow }],
      ),
    ).toEqual([
      {
        code: "certification_insufficient",
        params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
      },
    ]);
  });

  it("goes back to the serious line once the course ends without a card", () => {
    // Either the diver did not finish, or the instructor has a tap to make;
    // both are somebody's job now, and the soft line would hide it.
    expect(
      certificationBlockers(
        [certification({ level: "open_water" })],
        [{ level: "advanced_open_water", finishesAt: yesterday }],
      ),
    ).toEqual([expect.objectContaining({ code: "certification_insufficient" })]);
    expect(
      certificationBlockers([], [{ level: "advanced_open_water", finishesAt: yesterday }]),
    ).toEqual([{ code: "certification_missing" }]);
  });

  describe("a course that ended without a card (issue #2058)", () => {
    const ended = (
      level: Certification["level"],
      finishesAt = yesterday,
      tripId = "aow-session",
    ) => ({
      level,
      finishesAt,
      tripId,
    });
    function endedBlockers(
      certifications: Certification[],
      coursesEnded: ReturnType<typeof ended>[],
    ) {
      return calculateReadiness({
        timezone: "UTC",
        requirement,
        waiver: signedWaiver,
        certifications,
        coursesEnded,
        now,
      });
    }

    it("names the session on the blocker, and the blocker still stands", () => {
      const result = endedBlockers([], [ended("advanced_open_water")]);
      expect(result.status).toBe("blocked");
      expect(result.blockers).toEqual([
        { code: "certification_missing", params: { endedCourseTripId: "aow-session" } },
      ]);
      expect(
        endedBlockers([certification({ level: "open_water" })], [ended("advanced_open_water")])
          .blockers,
      ).toEqual([
        {
          code: "certification_insufficient",
          params: {
            requiredLevel: "advanced_open_water",
            heldLevel: "open_water",
            endedCourseTripId: "aow-session",
          },
        },
      ]);
    });

    it("never names a course below the trip's level, and names the latest of two", () => {
      expect(endedBlockers([], [ended("open_water")]).blockers).toEqual([
        { code: "certification_missing" },
      ]);
      const earlier = new Date("2026-07-10T16:00:00.000Z");
      expect(
        endedBlockers(
          [],
          [ended("advanced_open_water", earlier, "first"), ended("rescue", yesterday, "second")],
        ).blockers,
      ).toEqual([{ code: "certification_missing", params: { endedCourseTripId: "second" } }]);
    });

    it("leaves a card waiting on review alone: that card is the fix", () => {
      expect(
        endedBlockers(
          [certification({ status: "pending", level: "advanced_open_water" })],
          [ended("advanced_open_water")],
        ).blockers,
      ).toEqual([{ code: "certification_pending" }]);
    });

    // Agency review G6: the diver's own word about a card is checked against
    // the card, so the fix is verifying it, not the session's roster.
    it("leaves a self-declared card alone: verifying it is the fix", () => {
      const blockers = endedBlockers(
        [
          certification({
            status: "pending",
            level: "advanced_open_water",
            selfDeclaredAt: new Date("2026-07-17T00:00:00Z"),
          }),
        ],
        [ended("advanced_open_water")],
      ).blockers;
      expect(blockers.map((blocker) => blocker.code)).toEqual(["certification_self_declared"]);
      expect(blockers[0]?.params?.endedCourseTripId).toBeUndefined();
    });

    it("clears nothing: the issued card is still what boards them", () => {
      expect(endedBlockers([certification()], [ended("advanced_open_water")])).toEqual({
        status: "ready",
        blockers: [],
      });
    });
  });

  it("prefers a card on file at the level over the course", () => {
    expect(
      certificationBlockers(
        [certification({ status: "pending", level: "advanced_open_water" })],
        [{ level: "advanced_open_water", finishesAt: tomorrow }],
      ),
    ).toEqual([{ code: "certification_pending" }]);
  });

  it("clears on the issued card, course or no course", () => {
    expect(
      calculateReadiness({
        timezone: "UTC",
        requirement,
        waiver: signedWaiver,
        certifications: [certification()],
        certificationsInTraining: [{ level: "advanced_open_water", finishesAt: tomorrow }],
        now,
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("names the highest verified card beside a level the diver does not reach", () => {
    expect(
      certificationBlockers(
        [
          certification({ level: "open_water" }),
          certification({ level: "advanced_open_water", status: "pending" }),
        ],
        [],
      ),
    ).toEqual([{ code: "certification_pending" }]);
    expect(
      calculateReadiness({
        timezone: "UTC",
        requirement: { ...requirement, minimumCertificationLevel: "rescue" } as TripRequirement,
        waiver: signedWaiver,
        certifications: [
          certification({ level: "open_water" }),
          certification({ level: "advanced_open_water" }),
        ],
        now,
      }).blockers,
    ).toEqual([
      {
        code: "certification_insufficient",
        params: { requiredLevel: "rescue", heldLevel: "advanced_open_water" },
      },
    ]);
  });
});
