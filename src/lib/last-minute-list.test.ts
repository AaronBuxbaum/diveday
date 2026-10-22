import { describe, expect, it } from "vitest";
import { generateLastMinutePromoCode, isValidLastMinuteDiscountPercent } from "./last-minute-list";

describe("isValidLastMinuteDiscountPercent", () => {
  it("accepts integers inside the shop discount range", () => {
    expect(isValidLastMinuteDiscountPercent(50)).toBe(true);
    expect(isValidLastMinuteDiscountPercent(5)).toBe(true);
    expect(isValidLastMinuteDiscountPercent(90)).toBe(true);
  });

  it("rejects out-of-range or non-integer values", () => {
    expect(isValidLastMinuteDiscountPercent(4)).toBe(false);
    expect(isValidLastMinuteDiscountPercent(91)).toBe(false);
    expect(isValidLastMinuteDiscountPercent(50.5)).toBe(false);
    expect(isValidLastMinuteDiscountPercent(0)).toBe(false);
  });
});

describe("generateLastMinutePromoCode", () => {
  it("embeds the discount percent and stays within a typeable length", () => {
    const code = generateLastMinutePromoCode(50);
    expect(code).toMatch(/^SAVE50-[0-9A-F]{6}$/);
  });

  it("generates distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateLastMinutePromoCode(25)));
    expect(codes.size).toBe(20);
  });
});
