/**
 * The preflight checklist for a material manifest-affecting change. It is
 * deliberately pure so a UI, an API, and a future offline editor can all run
 * the same safety ritual before writing.
 */
export type ManifestChangeRiskCode =
  | "roster_member_dropped"
  | "capacity_below_roster"
  | "checkpoint_history_orphaned"
  | "course_without_instructor"
  | "no_crew_assigned"
  | "boarding_gate_changed";

export type ManifestChangeReview = {
  risks: { code: ManifestChangeRiskCode; blocking: boolean; detail: string }[];
  blocking: boolean;
};

export function reviewManifestChange(input: {
  currentBookingIds?: readonly string[];
  proposedBookingIds?: readonly string[];
  proposedCapacity?: number;
  recordedDiveCount?: number;
  proposedDiveCount?: number;
  courseRequiresInstructor?: boolean;
  proposedCrew?: readonly { roles: readonly string[] }[];
  boardingGateChanged?: boolean;
}): ManifestChangeReview {
  const risks: ManifestChangeReview["risks"] = [];
  const current = new Set(input.currentBookingIds ?? []);
  const proposed = new Set(input.proposedBookingIds ?? input.currentBookingIds ?? []);

  if ([...current].some((bookingId) => !proposed.has(bookingId))) {
    risks.push({
      code: "roster_member_dropped",
      blocking: true,
      detail: "An active booking would disappear from the manifest.",
    });
  }
  if (
    input.proposedCapacity !== undefined &&
    input.proposedCapacity < Math.max(current.size, proposed.size)
  ) {
    risks.push({
      code: "capacity_below_roster",
      blocking: true,
      detail: "Capacity would be lower than the active roster.",
    });
  }
  if (
    input.proposedDiveCount !== undefined &&
    input.recordedDiveCount !== undefined &&
    input.proposedDiveCount < input.recordedDiveCount
  ) {
    risks.push({
      code: "checkpoint_history_orphaned",
      blocking: true,
      detail: "A recorded roll-call checkpoint would no longer have a planned dive.",
    });
  }
  if (
    input.courseRequiresInstructor &&
    !(input.proposedCrew ?? []).some((member) => member.roles.includes("instructor"))
  ) {
    risks.push({
      code: "course_without_instructor",
      blocking: true,
      detail: "A course session would have no assigned instructor.",
    });
  }
  if (input.proposedCrew && input.proposedCrew.length === 0) {
    risks.push({
      code: "no_crew_assigned",
      blocking: false,
      detail: "The boat has no assigned crew; coverage needs an explicit staff decision.",
    });
  }
  if (input.boardingGateChanged) {
    risks.push({
      code: "boarding_gate_changed",
      blocking: false,
      detail: "Every active diver must be rechecked against the new boarding requirements.",
    });
  }

  return { risks, blocking: risks.some((risk) => risk.blocking) };
}
