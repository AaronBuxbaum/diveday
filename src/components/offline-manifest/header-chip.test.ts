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

  it("says offline, and never 'Fresh', with no signal or no answer", () => {
    for (const freshness of ["current", "aging", "stale"] as const) {
      expect(offlineHeaderChip({ online: false, servedWithoutAnswer: false, freshness })).toEqual({
        kind: "connectivity",
      });
      expect(offlineHeaderChip({ online: true, servedWithoutAnswer: true, freshness })).toEqual({
        kind: "connectivity",
      });
    }
  });
});
