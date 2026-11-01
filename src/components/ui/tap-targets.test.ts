import { describe, expect, it } from "vitest";
import { tapTargetLinkClass, tapTargetOverhangClass } from "./button";

describe("quiet link tap targets", () => {
  it("keeps every shared target at least 44px tall and wide", () => {
    const targets = [
      tapTargetLinkClass,
      tapTargetOverhangClass.up.target,
      tapTargetOverhangClass.down.target,
    ];
    for (const classes of targets) {
      expect(classes).toContain("min-h-11");
      expect(classes).toContain("min-w-11");
    }
  });
});
