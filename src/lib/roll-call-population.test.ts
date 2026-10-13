import { describe, expect, it } from "vitest";
import { inAfterDivePopulation, isAccountedForAfterDive } from "./roll-call-population";

/**
 * Who an after-dive head count is counting (glossary, "Unaccounted for"). A
 * person missing from the count is a person nobody looks for, so the
 * population errs toward including: any mark after the dock puts someone in.
 */
describe("inAfterDivePopulation", () => {
  it("includes anyone boarded at the dock", () => {
    expect(inAfterDivePopulation(["boarded"])).toBe(true);
    expect(inAfterDivePopulation(["boarded", undefined, undefined])).toBe(true);
  });

  it("includes anyone with any result at a later checkpoint, whatever the dock said", () => {
    expect(inAfterDivePopulation([undefined, "not_boarded"])).toBe(true);
    expect(inAfterDivePopulation(["not_boarded", undefined, "boarded"])).toBe(true);
  });

  it("leaves out a seat with no mark anywhere, and a dockside not-boarded alone", () => {
    expect(inAfterDivePopulation([])).toBe(false);
    expect(inAfterDivePopulation([undefined, undefined])).toBe(false);
    expect(inAfterDivePopulation(["not_boarded", undefined])).toBe(false);
  });
});

describe("isAccountedForAfterDive", () => {
  it("is closed by boarded and by nothing else", () => {
    expect(isAccountedForAfterDive("boarded")).toBe(true);
    expect(isAccountedForAfterDive("not_boarded")).toBe(false);
    expect(isAccountedForAfterDive(undefined)).toBe(false);
  });
});
