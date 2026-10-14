import { describe, expect, it } from "vitest";
import {
  checkpointGap,
  homewardCheckpointGap,
  isHomewardStage,
  previousCheckpointGaps,
} from "./checkpoint-gaps";
import type { RollCallCheckpoint, TripManifest } from "./manifests";

/**
 * Batch 6, items 3 and 4: the two roll-call warnings read one count, the one
 * a checkpoint's own completeness verdict closes on — divers and crew.
 */
function at(
  checkpoint: RollCallCheckpoint,
  counts: {
    awaiting?: number;
    notBackAboard?: number;
    crewAwaiting?: number;
    crewNotBackAboard?: number;
    notBoarded?: number;
  } = {},
): Pick<TripManifest, "checkpoint" | "summary" | "completeness"> {
  return {
    checkpoint,
    summary: {
      totalDivers: 8,
      ready: 8,
      blocked: 0,
      boarded: 0,
      notBoarded: counts.notBoarded ?? 0,
      notBackAboard: counts.notBackAboard ?? 0,
      awaiting: counts.awaiting ?? 0,
      unaccountedFor: (counts.awaiting ?? 0) + (counts.notBackAboard ?? 0),
      overCapacity: 0,
      notHere: 0,
    },
    completeness: {
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: false,
      reason: null,
      crewReason: null,
      crewCounts: {
        crewAssigned: 2,
        crewAwaiting: counts.crewAwaiting ?? 0,
        crewNotBackAboard: counts.crewNotBackAboard ?? 0,
        crewAshore: 0,
      },
    },
  };
}

describe("checkpointGap", () => {
  it("counts divers unmarked and not back aboard, and the crew's two halves", () => {
    expect(
      checkpointGap(
        at("after_dive_1", {
          awaiting: 1,
          notBackAboard: 1,
          crewAwaiting: 1,
          crewNotBackAboard: 1,
        }),
      ),
    ).toEqual({ checkpoint: "after_dive_1", unaccounted: 4 });
  });

  it("is null when everyone is accounted for", () => {
    expect(checkpointGap(at("after_dive_1"))).toBeNull();
  });

  it("does not count a diver left ashore at the dock — the dock's not boarded is settled", () => {
    expect(checkpointGap(at("departure", { notBoarded: 2 }))).toBeNull();
    expect(checkpointGap(at("after_dive_1", { notBoarded: 2 }))).toBeNull();
  });

  it("names a crew member still in the water even when every diver is back", () => {
    expect(checkpointGap(at("after_dive_2", { crewNotBackAboard: 1 }))).toEqual({
      checkpoint: "after_dive_2",
      unaccounted: 1,
    });
  });
});

describe("previousCheckpointGaps", () => {
  it("keys each checkpoint by the gap at the one before it", () => {
    const gaps = previousCheckpointGaps([
      at("departure", { awaiting: 1 }),
      at("after_dive_1", { awaiting: 2 }),
      at("after_dive_2"),
      at("after_dive_3", { notBackAboard: 1 }),
    ]);
    // The dock is never the "before": dive 1's count is what settles who is aboard.
    expect(gaps.has("after_dive_1")).toBe(false);
    expect(gaps.get("after_dive_2")).toEqual({ checkpoint: "after_dive_1", unaccounted: 2 });
    // Dive 2 closed, so opening dive 3 warns about nothing.
    expect(gaps.has("after_dive_3")).toBe(false);
    // The dock has nothing before it.
    expect(gaps.has("departure")).toBe(false);
  });

  it("is empty for a departure counted all the way through", () => {
    expect(previousCheckpointGaps([at("departure"), at("after_dive_1")]).size).toBe(0);
  });
});

describe("homewardCheckpointGap", () => {
  it("asks the last after-dive checkpoint, the head count of who is aboard now", () => {
    expect(
      homewardCheckpointGap([
        at("departure"),
        at("after_dive_1"),
        at("after_dive_2", { awaiting: 3 }),
      ]),
    ).toEqual({ checkpoint: "after_dive_2", unaccounted: 3 });
  });

  it("lets a later full count settle an earlier gap", () => {
    expect(
      homewardCheckpointGap([
        at("departure"),
        at("after_dive_1", { notBackAboard: 1 }),
        at("after_dive_2"),
      ]),
    ).toBeNull();
  });

  it("raises nothing for a list with no after-dive checkpoint, or none at all", () => {
    expect(homewardCheckpointGap([at("departure", { awaiting: 4 })])).toBeNull();
    expect(homewardCheckpointGap([])).toBeNull();
  });
});

describe("isHomewardStage", () => {
  it("is the two words that say the diving is over", () => {
    expect(isHomewardStage("heading_in")).toBe(true);
    expect(isHomewardStage("home")).toBe(true);
    expect(isHomewardStage("surface")).toBe(false);
    expect(isHomewardStage("boarding")).toBe(false);
  });
});
