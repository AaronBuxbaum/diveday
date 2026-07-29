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
      proposedCrew: [{ roles: ["captain"] }],
      boardingGateChanged: true,
    });
    expect(review.risks.map((risk) => risk.code)).toEqual([
      "checkpoint_history_orphaned",
      "course_without_instructor",
      "boarding_gate_changed",
    ]);
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
