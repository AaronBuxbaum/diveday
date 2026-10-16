import { describe, expect, it } from "vitest";
import {
  checkpointGap,
  homewardCheckpointGap,
  isHomewardStage,
  plannedDivesWithout,
  previousCheckpointGaps,
} from "./checkpoint-gaps";
import type { RollCallCheckpoint } from "./manifests";

/**
 * Batch 6, items 3 and 4: the two roll-call warnings. Divers are the ones the
 * checkpoint's completeness verdict closes on; crew follow Today's population
 * rule, and the two halves are reported apart (dive-domain review 20261014).
 */
type Crew = { id: string; state?: "boarded" | "not_boarded"; implied?: boolean };

function at(
  checkpoint: RollCallCheckpoint,
  counts: {
    awaiting?: number;
    notBackAboard?: number;
    boarded?: number;
    notBoarded?: number;
    crew?: Crew[];
  } = {},
) {
  return {
    checkpoint,
    summary: {
      totalDivers: 8,
      ready: 8,
      blocked: 0,
      boarded: counts.boarded ?? 0,
      notBoarded: counts.notBoarded ?? 0,
      notBackAboard: counts.notBackAboard ?? 0,
      awaiting: counts.awaiting ?? 0,
      unaccountedFor: (counts.awaiting ?? 0) + (counts.notBackAboard ?? 0),
      overCapacity: 0,
      notHere: 0,
    },
    crew: (counts.crew ?? []).map((member) => ({
      id: member.id,
      rollCall: member.state
        ? {
            state: member.state,
            implied: member.implied,
            occurredAt: new Date("2026-10-14T12:00:00Z"),
            recordedByName: "Marco",
          }
        : undefined,
    })),
  };
}

describe("checkpointGap", () => {
  it("reports divers and crew apart, and the people marked not back aboard on their own", () => {
    const list = [
      at("departure", {
        crew: [
          { id: "dm", state: "boarded" },
          { id: "ow", state: "boarded" },
        ],
      }),
      at("after_dive_1", {
        awaiting: 1,
        notBackAboard: 1,
        crew: [{ id: "dm" }, { id: "ow", state: "not_boarded" }],
      }),
    ];
    expect(checkpointGap(list, "after_dive_1")).toEqual({
      kind: "unmarked",
      checkpoint: "after_dive_1",
      divers: 1,
      crew: 1,
      missing: 2,
    });
  });

  it("is null when everyone is accounted for", () => {
    expect(checkpointGap([at("departure"), at("after_dive_1")], "after_dive_1")).toBeNull();
  });

  it("does not count a diver left ashore at the dock — the dock's not boarded is settled", () => {
    expect(checkpointGap([at("departure", { notBoarded: 2 })], "departure")).toBeNull();
    expect(
      checkpointGap([at("departure"), at("after_dive_1", { notBoarded: 2 })], "after_dive_1"),
    ).toBeNull();
  });

  it("names a crew member still in the water even when every diver is back", () => {
    const list = [
      at("departure"),
      at("after_dive_1"),
      at("after_dive_2", { crew: [{ id: "dm", state: "not_boarded" }] }),
    ];
    expect(checkpointGap(list, "after_dive_2")).toEqual({
      kind: "unmarked",
      checkpoint: "after_dive_2",
      divers: 0,
      crew: 0,
      missing: 1,
    });
  });

  describe("the crew population rule Today keeps (inAfterDivePopulation)", () => {
    it("leaves out crew nobody has ever counted, so a shop without crew roll call is not warned", () => {
      const list = [
        at("departure", { crew: [{ id: "dm" }, { id: "ow" }] }),
        at("after_dive_1", { crew: [{ id: "dm" }, { id: "ow" }] }),
      ];
      expect(checkpointGap(list, "after_dive_1")).toBeNull();
    });

    it("counts an unmarked crew member boarded at the dock", () => {
      const list = [
        at("departure", { crew: [{ id: "dm", state: "boarded" }, { id: "ow" }] }),
        at("after_dive_1", { crew: [{ id: "dm" }, { id: "ow" }] }),
      ];
      expect(checkpointGap(list, "after_dive_1")).toMatchObject({ divers: 0, crew: 1 });
    });

    it("counts one with a result at a later after-dive checkpoint", () => {
      const list = [
        at("departure", { crew: [{ id: "dm" }] }),
        at("after_dive_1", { crew: [{ id: "dm" }] }),
        at("after_dive_2", { crew: [{ id: "dm", state: "boarded" }] }),
      ];
      expect(checkpointGap(list, "after_dive_1")).toMatchObject({ crew: 1 });
    });

    it("does not let a carried-forward result put somebody in the count", () => {
      const list = [
        at("departure", { crew: [{ id: "dm" }] }),
        at("after_dive_1", { crew: [{ id: "dm", state: "not_boarded", implied: true }] }),
        at("after_dive_2", { crew: [{ id: "dm" }] }),
      ];
      expect(checkpointGap(list, "after_dive_2")).toBeNull();
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
    expect(gaps.get("after_dive_2")).toEqual({
      kind: "unmarked",
      checkpoint: "after_dive_1",
      divers: 2,
      crew: 0,
      missing: 0,
    });
    // Dive 2 closed, so opening dive 3 warns about nothing.
    expect(gaps.has("after_dive_3")).toBe(false);
    // The dock has nothing before it.
    expect(gaps.has("departure")).toBe(false);
  });

  it("is empty for a departure counted all the way through", () => {
    expect(previousCheckpointGaps([at("departure"), at("after_dive_1")]).size).toBe(0);
  });

  it("raises nothing for crew a shop never counts", () => {
    const crew = [{ id: "dm" }];
    expect(
      previousCheckpointGaps([
        at("departure", { crew }),
        at("after_dive_1", { boarded: 8, crew }),
        at("after_dive_2", { crew }),
      ]).size,
    ).toBe(0);
  });
});

describe("homewardCheckpointGap", () => {
  it("asks the last after-dive checkpoint, the head count of who is aboard now", () => {
    expect(
      homewardCheckpointGap([
        at("departure"),
        at("after_dive_1", { boarded: 8 }),
        at("after_dive_2", { boarded: 5, awaiting: 3 }),
      ]),
    ).toEqual({ kind: "unmarked", checkpoint: "after_dive_2", divers: 3, crew: 0, missing: 0 });
  });

  it("lets a later full count settle an earlier gap", () => {
    expect(
      homewardCheckpointGap([
        at("departure"),
        at("after_dive_1", { notBackAboard: 1 }),
        at("after_dive_2", { boarded: 8 }),
      ]),
    ).toBeNull();
  });

  it("raises nothing for a list with no after-dive checkpoint, or none at all", () => {
    expect(homewardCheckpointGap([at("departure", { awaiting: 4 })])).toBeNull();
    expect(homewardCheckpointGap([])).toBeNull();
  });

  describe("a last dive nobody counted after a closed one", () => {
    it("is worded as a plan question, still a warning", () => {
      const gap = homewardCheckpointGap([
        at("departure"),
        at("after_dive_1", { boarded: 8 }),
        at("after_dive_2", { awaiting: 8 }),
      ]);
      expect(gap).toEqual({ kind: "not_counted", checkpoint: "after_dive_2" });
      if (!gap) throw new Error("expected a gap");
      expect(plannedDivesWithout(gap)).toBe(1);
    });

    it("stays a head-count warning once anybody is counted there", () => {
      expect(
        homewardCheckpointGap([
          at("departure"),
          at("after_dive_1", { boarded: 8 }),
          at("after_dive_2", { awaiting: 8, crew: [{ id: "dm", state: "boarded" }] }),
        ]),
      ).toEqual({ kind: "unmarked", checkpoint: "after_dive_2", divers: 8, crew: 0, missing: 0 });
    });

    it("stays a head-count warning when the dive before is open too", () => {
      expect(
        homewardCheckpointGap([
          at("departure"),
          at("after_dive_1", { boarded: 7, awaiting: 1 }),
          at("after_dive_2", { awaiting: 8 }),
        ]),
      ).toMatchObject({ kind: "unmarked", divers: 8 });
    });

    it("never offers a one-dive trip a plan of none", () => {
      expect(
        homewardCheckpointGap([
          at("departure", { boarded: 8 }),
          at("after_dive_1", { awaiting: 8 }),
        ]),
      ).toMatchObject({ kind: "unmarked", divers: 8 });
    });
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
