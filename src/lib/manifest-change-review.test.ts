import { describe, expect, it } from "vitest";
import { reviewManifestChange } from "./manifest-change-review";

describe("reviewManifestChange", () => {
  it("blocks dropping an active diver or shrinking below the live roster", () => {
    const review = reviewManifestChange({
      currentBookingIds: ["a", "b"],
      proposedBookingIds: ["a"],
      proposedCapacity: 1,
    });
    expect(review.blocking).toBe(true);
    expect(review.risks.map((risk) => risk.code)).toEqual([
      "roster_member_dropped",
      "capacity_below_roster",
    ]);
  });

  it("enumerates the course, checkpoint, and gate-change failure modes", () => {
    const review = reviewManifestChange({
      recordedDiveCount: 2,
      proposedDiveCount: 1,
      courseRequiresInstructor: true,
      proposedCrew: [{ shopRoles: ["captain"] }],
      boardingGateChanged: true,
    });
    expect(review.risks.map((risk) => risk.code)).toEqual([
      "checkpoint_history_orphaned",
      "course_without_instructor",
      "boarding_gate_changed",
    ]);
  });

  /**
   * "Has an instructor" is `inWaterCrewRole` (src/lib/crew-roles.ts), the one
   * definition — never a scan of `person_roles` here. A shop-wide instructor
   * rostered as *this session's captain* is driving the boat, and a course
   * session whose only instructor is on the helm has no instructor (review
   * 20260803, D8).
   */
  it("reads the job on this sailing, not the standing role, for the instructor check", () => {
    const rosteredAsCaptain = reviewManifestChange({
      courseRequiresInstructor: true,
      proposedCrew: [{ tripRole: "captain", shopRoles: ["instructor"] }],
    });
    expect(rosteredAsCaptain.risks.map((risk) => risk.code)).toContain("course_without_instructor");
    expect(rosteredAsCaptain.blocking).toBe(true);
    // Unspecified stays the status quo: shop-wide inference, exactly as before.
    expect(
      reviewManifestChange({
        courseRequiresInstructor: true,
        proposedCrew: [{ shopRoles: ["instructor"] }],
      }).blocking,
    ).toBe(false);
    // And the roster can never mint a credential: rostering a deckhand as the
    // instructor buys the session nothing.
    expect(
      reviewManifestChange({
        courseRequiresInstructor: true,
        proposedCrew: [{ tripRole: "instructor", shopRoles: ["crew"] }],
      }).blocking,
    ).toBe(true);
  });

  it("keeps an empty crew visible as a non-blocking operational gap", () => {
    expect(reviewManifestChange({ proposedCrew: [] })).toEqual({
      blocking: false,
      risks: [
        {
          code: "no_crew_assigned",
          blocking: false,
          detail: "The boat has no assigned crew; coverage needs an explicit staff decision.",
        },
      ],
    });
  });
});
