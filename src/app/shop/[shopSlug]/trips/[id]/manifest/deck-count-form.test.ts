import { describe, expect, it } from "vitest";
import { deckCountSchema } from "./deck-count-form";

const parse = (counted: unknown) => deckCountSchema.safeParse({ counted });

describe("deckCountSchema", () => {
  it("takes a whole count from zero to the cap", () => {
    expect(parse("12")).toMatchObject({ success: true, data: { counted: 12 } });
    expect(parse(" 0 ")).toMatchObject({ success: true, data: { counted: 0 } });
  });

  it("refuses a blank field rather than reading it as zero", () => {
    expect(parse("").success).toBe(false);
    expect(parse("   ").success).toBe(false);
    expect(parse(undefined).success).toBe(false);
  });

  it("refuses anything that is not plain digits, and a count past the cap", () => {
    for (const value of ["1e2", "0x0c", "-1", "2.5", "1000", "twelve"]) {
      expect(parse(value).success).toBe(false);
    }
  });
});
