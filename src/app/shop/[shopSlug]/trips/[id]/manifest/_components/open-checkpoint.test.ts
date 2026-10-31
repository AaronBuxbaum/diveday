import { describe, expect, it } from "vitest";
import { diver } from "./diver-roll-call-test-fixtures";
import { tripManifest } from "./manifest-page-test-fixtures";
import { openCheckpoint } from "./open-checkpoint";

const departure = tripManifest({ checkpoint: "departure" });
const afterOne = tripManifest({ checkpoint: "after_dive_1" });
const afterTwo = tripManifest({ checkpoint: "after_dive_2" });
const all = [departure, afterOne, afterTwo];

function opened(result: ReturnType<typeof openCheckpoint>) {
  if ("stale" in result) throw new Error("expected an opened checkpoint, got a stale one");
  return result;
}

describe("openCheckpoint", () => {
  it("opens the checkpoint the URL asks for when the departure has it", () => {
    const page = opened(openCheckpoint(all, departure, "after_dive_2"));
    expect(page.checkpoint).toBe("after_dive_2");
    expect(page.isDeparture).toBe(false);
  });

  it("opens the dock when the URL names no checkpoint", () => {
    expect(opened(openCheckpoint(all, departure, undefined)).checkpoint).toBe("departure");
    expect(opened(openCheckpoint(all, departure, "departure")).isDeparture).toBe(true);
  });

  /**
   * **A stale or wrong `?checkpoint=` is sent to the canonical address**
   * (#2508), never answered with the dock under it: a bookmarked
   * `after_dive_3` would otherwise flip silently to the after-dive view once
   * the plan grows to three dives.
   */
  it("calls a checkpoint the plan does not have stale, rather than opening the dock under it", () => {
    expect(openCheckpoint(all, departure, "after_dive_3")).toEqual({ stale: true });
    expect(openCheckpoint(all, departure, "nonsense")).toEqual({ stale: true });
    expect(openCheckpoint(all, departure, "")).toEqual({ stale: true });
  });

  /**
   * Every checkpoint's manifest comes from `rollCallCheckpoints(plannedDives)`,
   * so a real checkpoint with no manifest is an assembly bug. Answering it as
   * the dock is the fail-open shape this codebase refuses elsewhere.
   */
  it("throws for a real checkpoint whose manifest is missing, never opening the dock", () => {
    expect(() => openCheckpoint([departure], departure, "after_dive_1")).toThrow(/after_dive_1/);
  });

  it("withholds a held seat's matched particulars before anything reads the row", () => {
    const held = diver({
      identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
      emergencyContactName: "Matched Person",
    } as never);
    const page = opened(
      openCheckpoint(
        [tripManifest({ checkpoint: "departure", divers: [held] })],
        departure,
        undefined,
      ),
    );
    expect(page.manifest.divers[0]?.identityWithheld).toBe(true);
    expect(page.manifest.divers[0]?.fullName).toBe("Maria");
    expect(page.manifest.divers[0]?.emergencyContactName).toBeNull();
  });
});
