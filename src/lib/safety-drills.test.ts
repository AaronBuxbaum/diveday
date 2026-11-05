import { describe, expect, it } from "vitest";
import { DRILL_KINDS, DRILL_NOTE_MAX, isDrillKind } from "./safety-drills";

/** The drill log (loop 5, row 2, E3): the record a renewal reads, never a gate. */
describe("isDrillKind", () => {
  it("takes the four kinds and nothing else", () => {
    expect(DRILL_KINDS).toEqual(["oxygen", "missing_diver", "overboard", "fire"]);
    expect(isDrillKind("oxygen")).toBe(true);
    expect(isDrillKind("OXYGEN")).toBe(false);
    expect(isDrillKind("")).toBe(false);
    expect(DRILL_NOTE_MAX).toBe(500);
  });
});
