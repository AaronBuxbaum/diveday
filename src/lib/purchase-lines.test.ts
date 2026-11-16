import { describe, expect, it } from "vitest";
import { purchaseAmount, purchaseFormTotal } from "./purchase-lines";

describe("counter amount preview", () => {
  it("distinguishes missing or malformed prices from a valid zero", () => {
    expect(purchaseFormTotal([{ quantity: "1", unitAmount: "" }], "usd")).toBeNull();
    expect(purchaseFormTotal([{ quantity: "1.5", unitAmount: "2" }], "usd")).toBeNull();
    expect(purchaseFormTotal([{ quantity: "1", unitAmount: "0" }], "usd")).toBe(0);
    expect(purchaseFormTotal([{ quantity: "2", unitAmount: "12.50" }], "usd")).toBe(2500);
  });
  it("uses exact native-currency units without exponent parsing or rounding", () => {
    expect(purchaseAmount("1e3", "usd")).toBeNull();
    expect(purchaseAmount("1.001", "usd")).toBeNull();
    expect(purchaseAmount("1.5", "jpy")).toBeNull();
    expect(purchaseAmount("150", "jpy")).toBe(150);
  });
});
