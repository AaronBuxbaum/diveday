import { describe, expect, it } from "vitest";
import { offlineHeaderChip } from "./header-chip";

describe("offlineHeaderChip", () => {
  it("folds Online and Fresh copy into one chip for a current copy with signal", () => {
    expect(
      offlineHeaderChip({ online: true, servedWithoutAnswer: false, freshness: "current" }),
    ).toEqual({ kind: "freshness", freshness: "current", online: true });
  });

  it("keeps an aging or stale copy's own chip, never 'online' beside it", () => {
    for (const freshness of ["aging", "stale"] as const) {
      expect(offlineHeaderChip({ online: true, servedWithoutAnswer: false, freshness })).toEqual({
        kind: "freshness",
        freshness,
        online: false,
      });
    }
  });

  it("keeps the copy's own freshness chip with no signal, never 'online'", () => {
    for (const freshness of ["current", "aging", "stale"] as const) {
      expect(offlineHeaderChip({ online: false, servedWithoutAnswer: false, freshness })).toEqual({
        kind: "freshness",
        freshness,
        online: false,
      });
    }
  });

  it("never says 'Fresh' on a copy opened because DiveDay did not answer", () => {
    for (const online of [true, false]) {
      for (const freshness of ["current", "aging", "stale"] as const) {
        expect(offlineHeaderChip({ online, servedWithoutAnswer: true, freshness })).toEqual({
          kind: "connectivity",
        });
      }
    }
  });
});
