import { describe, expect, it } from "vitest";
import { unguardFormula } from "./csv-formula";
import { csvCell } from "./export";

describe("unguardFormula", () => {
  it.each([
    "=SUM(A1)",
    "@cmd",
    "\t=x",
    "  =x",
    "＝x",
    "-1+cmd|' /C calc'!A0",
    "+1 305 555 0100",
    "'Tis the season",
    "plain",
  ])("round-trips %j through the export guard", (original) => {
    expect(unguardFormula(csvCell(original).replace(/^"|"$/g, ""))).toBe(original);
  });

  it("leaves a typed apostrophe before a number alone", () => {
    expect(unguardFormula("'-5")).toBe("'-5");
  });
});
