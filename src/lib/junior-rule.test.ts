import { describe, expect, it } from "vitest";
import { juniorRuleForAge } from "./junior-rule";

describe("juniorRuleForAge", () => {
  it("says the shop will be in touch under the agency minimum, and refuses nothing", () => {
    expect(juniorRuleForAge(9, null, "feet")).toEqual({ kind: "below_minimum" });
    expect(juniorRuleForAge(0, 30, "feet")).toEqual({ kind: "below_minimum" });
  });

  it("gives ten and eleven 40 feet with a professional or a certified parent", () => {
    expect(juniorRuleForAge(10, null, "feet")).toEqual({
      kind: "junior",
      supervision: "professional_or_parent",
      limit: 40,
      unit: "feet",
      deeperSites: false,
    });
    expect(juniorRuleForAge(11, null, "meters")).toMatchObject({ limit: 12, unit: "meters" });
  });

  it("gives twelve to fourteen 60 feet with any certified adult", () => {
    expect(juniorRuleForAge(12, null, "feet")).toMatchObject({
      supervision: "certified_adult",
      limit: 60,
    });
    expect(juniorRuleForAge(14, null, "meters")).toMatchObject({ limit: 18 });
  });

  it("has no junior rule from fifteen on", () => {
    expect(juniorRuleForAge(15, 40, "feet")).toBeNull();
    expect(juniorRuleForAge(17, 40, "feet")).toBeNull();
  });

  it("flags sites deeper than the limit, and not a site exactly at it", () => {
    // 46 ft reef, 121 ft wreck: the reef boat's depths from the issue.
    expect(juniorRuleForAge(12, 14.02, "feet")).toMatchObject({ deeperSites: false });
    expect(juniorRuleForAge(12, 36.9, "feet")).toMatchObject({ deeperSites: true });
    expect(juniorRuleForAge(10, 18.288, "feet")).toMatchObject({ deeperSites: true });
    expect(juniorRuleForAge(12, 18.288, "feet")).toMatchObject({ deeperSites: false });
  });

  it("stays quiet about depth when no site depth is known", () => {
    expect(juniorRuleForAge(12, null, "feet")).toMatchObject({ deeperSites: false });
  });
});
