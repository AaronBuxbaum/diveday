import { describe, expect, it } from "vitest";
import { toCoursePersonalGear } from "./course-personal-gear";

describe("course personal gear", () => {
  it("keeps only explicit snorkel and boots once in packing order", () => {
    expect(toCoursePersonalGear(["boots", "mask", "snorkel", "boots", "nitrox", null])).toEqual([
      "snorkel",
      "boots",
    ]);
    expect(toCoursePersonalGear([])).toEqual([]);
  });
});
