import { describe, expect, it } from "vitest";
import { VISIT_MILESTONES, visitMilestone } from "./visit-milestones";

/**
 * The stamp's rule, pinned rather than its pixels (ADR
 * 20260827-the-divers-thread, decision 4): a count inside the named set earns
 * the roundel and a count outside it keeps the plain ordinal line.
 */
describe("visitMilestone", () => {
  it("names every milestone in the set", () => {
    for (const milestone of VISIT_MILESTONES) {
      expect(visitMilestone(milestone)).toBe(milestone);
    }
  });

  it("is null for a count outside the set", () => {
    for (const count of [2, 3, 9, 11, 24, 26, 49, 99, 101, 1000]) {
      expect(visitMilestone(count)).toBeNull();
    }
  });

  it("marks the day a count is reached, never the ones after it", () => {
    // "At least 10" would put a roundel on every visit from the tenth on,
    // which is a sticker on the card forever rather than a day worth marking.
    expect(visitMilestone(10)).toBe(10);
    expect(visitMilestone(12)).toBeNull();
  });

  it("refuses a count that is not a whole visit", () => {
    expect(visitMilestone(0)).toBeNull();
    expect(visitMilestone(-1)).toBeNull();
    expect(visitMilestone(1.5)).toBeNull();
    expect(visitMilestone(Number.NaN)).toBeNull();
  });
});
