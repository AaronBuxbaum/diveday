import { describe, expect, it } from "vitest";
import { safetyRecordShown } from "./safety-record-shown";

/**
 * **The dive safety record stays reachable wherever someone sailed** (domain
 * review of layer D, finding 4): a blow-out called after the first tank still
 * counts for flying guidance, so a cancelled trip keeps the record when the
 * dock count boarded anyone, and loses it only when nobody sailed.
 */
describe("the dive safety record row", () => {
  it("waits until the plan is closed", () => {
    expect(safetyRecordShown({ detailsEditable: true, cancelled: false, boarded: 4 })).toBe(false);
  });

  it("shows on a finished trip", () => {
    expect(safetyRecordShown({ detailsEditable: false, cancelled: false, boarded: 0 })).toBe(true);
  });

  it("stays on a cancelled trip people sailed on", () => {
    expect(safetyRecordShown({ detailsEditable: false, cancelled: true, boarded: 3 })).toBe(true);
  });

  it("is gone from a cancelled trip nobody sailed on", () => {
    expect(safetyRecordShown({ detailsEditable: false, cancelled: true, boarded: 0 })).toBe(false);
  });
});
