import { describe, expect, it } from "vitest";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { boatSheetStatus } from "./boat-sheet-status";
import { t } from "./diver-roll-call-test-fixtures";

/**
 * **A printed Boat tab states what its screen only shows** (issue #4067):
 * the live "back aboard" tally, the dive before still being open, and a later
 * count with someone missing. Failing first: the sheet used to print none.
 */
type Result = { state: "boarded" | "not_boarded" } | undefined;

function at(
  checkpoint: RollCallCheckpoint,
  divers: { fullName: string; rollCall: Result }[],
  crew: { id: string; fullName: string; rollCall?: Result }[] = [],
) {
  const boarded = divers.filter((d) => d.rollCall?.state === "boarded").length;
  const notBackAboard = divers.filter(
    (d) => d.rollCall?.state === "not_boarded" && checkpoint !== "departure",
  ).length;
  return {
    checkpoint,
    summary: {
      totalDivers: divers.length,
      boarded,
      notBackAboard,
      awaiting: divers.length - boarded - notBackAboard,
    },
    divers,
    crew,
  } as never;
}

const BOARDED: Result = { state: "boarded" };
const MISSING: Result = { state: "not_boarded" };

function status(checkpoint: RollCallCheckpoint, manifests: ReturnType<typeof at>[]) {
  const manifest = manifests.find((m: { checkpoint: string }) => m.checkpoint === checkpoint);
  return boatSheetStatus({ manifests, manifest, checkpoint, t } as never);
}

describe("the Boat tab sheet's status lines", () => {
  const two = (a: Result, b: Result) => [
    { fullName: "Meera Iyer", rollCall: a },
    { fullName: "Theo Lind", rollCall: b },
  ];

  it("prints nothing at the dock", () => {
    expect(status("departure", [at("departure", two(BOARDED, BOARDED))])).toEqual([]);
  });

  it("prints X of N back aboard after a dive", () => {
    const lines = status("after_dive_1", [
      at("departure", two(BOARDED, BOARDED)),
      at("after_dive_1", two(BOARDED, undefined)),
    ]);
    expect(lines[0]).toBe("1 of 2 passengers back aboard after dive 1");
  });

  it("prints the open roll call of the dive before, as the screen says it", () => {
    const lines = status("after_dive_2", [
      at("departure", two(BOARDED, BOARDED)),
      at("after_dive_1", two(BOARDED, undefined)),
      at("after_dive_2", two(BOARDED, BOARDED)),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("not marked after dive 1");
  });

  it("names a later checkpoint and who is not back aboard there", () => {
    const lines = status("after_dive_1", [
      at("departure", two(BOARDED, BOARDED)),
      at("after_dive_1", two(BOARDED, BOARDED)),
      at("after_dive_2", two(BOARDED, MISSING)),
    ]);
    expect(lines.join(" ")).toContain("after dive 2");
    expect(lines.join(" ")).toContain("Theo Lind");
    expect(lines.join(" ")).toContain("not back aboard");
  });

  it("does not warn at the latest checkpoint", () => {
    const lines = status("after_dive_2", [
      at("departure", two(BOARDED, BOARDED)),
      at("after_dive_1", two(BOARDED, BOARDED)),
      at("after_dive_2", two(BOARDED, MISSING)),
    ]);
    expect(lines.join(" ")).not.toContain("later than this sheet");
  });
});
