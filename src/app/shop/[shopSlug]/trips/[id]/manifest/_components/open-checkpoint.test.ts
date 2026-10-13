import { describe, expect, it } from "vitest";
import { diver } from "./diver-roll-call-test-fixtures";
import { tripManifest } from "./manifest-page-test-fixtures";
import { openCheckpoint } from "./open-checkpoint";

const departure = tripManifest({ checkpoint: "departure" });
const afterOne = tripManifest({ checkpoint: "after_dive_1" });
const afterTwo = tripManifest({ checkpoint: "after_dive_2" });
const all = [departure, afterOne, afterTwo];

describe("openCheckpoint", () => {
  it("opens the checkpoint the URL asks for when the departure has it", () => {
    const opened = openCheckpoint(all, departure, "after_dive_2");
    expect(opened.checkpoint).toBe("after_dive_2");
    expect(opened.isDeparture).toBe(false);
    expect(opened.checkpoints).toEqual(["departure", "after_dive_1", "after_dive_2"]);
  });

  it("falls back to the dock for a checkpoint the plan does not have", () => {
    expect(openCheckpoint(all, departure, "after_dive_3").checkpoint).toBe("departure");
    expect(openCheckpoint(all, departure, "nonsense").isDeparture).toBe(true);
    expect(openCheckpoint(all, departure, undefined).checkpoint).toBe("departure");
  });

  it("opens the departure list when the checkpoint is unknown or has no manifest", () => {
    expect(openCheckpoint([departure], departure, "after_dive_1").checkpoint).toBe("departure");
  });

  it("withholds a held seat's matched particulars before anything reads the row", () => {
    const held = diver({
      identityClaim: { bookedAs: "Maria", matchedBy: "picked_name" },
      emergencyContactName: "Matched Person",
    } as never);
    const opened = openCheckpoint(
      [tripManifest({ checkpoint: "departure", divers: [held] })],
      departure,
      undefined,
    );
    expect(opened.manifest.divers[0]?.identityWithheld).toBe(true);
    expect(opened.manifest.divers[0]?.fullName).toBe("Maria");
    expect(opened.manifest.divers[0]?.emergencyContactName).toBeNull();
  });
});
