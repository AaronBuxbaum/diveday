import { describe, expect, it } from "vitest";
import { earlyAccessPrice, earlyAccessPriceAmount } from "./marketing";

describe("earlyAccessPriceAmount", () => {
  // JSON-LD offers need a bare number; it must stay a derivation of the one
  // price source, never drift into a second hand-written figure.
  it("derives a bare numeric amount from the single price source", () => {
    expect(earlyAccessPriceAmount).toMatch(/^\d+(\.\d+)?$/);
    expect(earlyAccessPrice.price).toContain(earlyAccessPriceAmount);
  });
});
