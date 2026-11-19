import { describe, expect, it } from "vitest";
import { effectiveRollCallKey, projectEffectiveRollCalls } from "./effective-roll-call";
import { foldRollCallEvidence } from "./roll-call-causality";

describe("effective roll-call evidence", () => {
  it("excludes an ineligible undo before following its causal edges", () => {
    const rows = [
      {
        id: "live",
        subject: "seat-1",
        checkpoint: "departure",
        day: 0,
        status: "not_boarded" as const,
      },
      {
        id: "old-undo",
        subject: "seat-1",
        checkpoint: "departure",
        day: 0,
        status: "cleared" as const,
        retracts: "live",
      },
    ];
    const projections = projectEffectiveRollCalls(rows, (row) => row.id !== "old-undo");
    expect(projections.get(effectiveRollCallKey("seat-1", "departure", 0))).toMatchObject({
      status: "not_boarded",
      frontier: ["live"],
    });
  });

  it("does not follow an ineligible statement as a bridge to erase live evidence", () => {
    const rows = [
      {
        id: "live",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 0,
        status: "not_boarded" as const,
      },
      {
        id: "old",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 0,
        status: "boarded" as const,
        observed: ["live"],
      },
      {
        id: "later",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 0,
        status: "boarded" as const,
        observed: ["old"],
      },
    ];
    const projections = projectEffectiveRollCalls(rows, (row) => row.id !== "old");
    expect(projections.get(effectiveRollCallKey("seat-1", "after_dive_1", 0))).toMatchObject({
      status: "not_boarded",
      conflict: true,
      frontier: ["later", "live"],
    });
  });

  it("folds original statements independently for each seat and checkpoint", () => {
    const rows = [
      {
        id: "live",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 0,
        status: "boarded" as const,
        statementStatus: "not_boarded" as const,
      },
      {
        id: "old",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 0,
        status: "boarded" as const,
        observed: ["live"],
      },
      {
        id: "other",
        subject: "seat-2",
        checkpoint: "after_dive_1",
        day: 0,
        status: "boarded" as const,
      },
    ];
    const projections = projectEffectiveRollCalls(rows, (row) => row.id !== "old");
    expect(projections.get(effectiveRollCallKey("seat-1", "after_dive_1", 0))).toMatchObject({
      status: "not_boarded",
      frontier: ["live"],
    });
    expect(projections.get(effectiveRollCallKey("seat-2", "after_dive_1", 0))).toMatchObject({
      status: "boarded",
      frontier: ["other"],
    });
  });

  it("preserves the existing day fold when every statement is eligible", () => {
    const rows = [
      {
        id: "earlier",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 0,
        status: "not_boarded" as const,
      },
      {
        id: "current",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: 1,
        status: "boarded" as const,
        observed: ["earlier"],
      },
      {
        id: "unknown-undo",
        subject: "seat-1",
        checkpoint: "after_dive_1",
        day: -1,
        status: "cleared" as const,
      },
    ];
    const projections = projectEffectiveRollCalls(rows, () => true);
    expect(projections.get(effectiveRollCallKey("seat-1", "after_dive_1", 1))).toEqual(
      foldRollCallEvidence(rows, "after_dive_1", new Set(["current", "unknown-undo"])),
    );
  });
});
