import { describe, expect, it } from "vitest";
import {
  generateLastMinutePromoCode,
  isValidLastMinuteDiscountPercent,
  lastMinuteEntryMatchesTripDate,
} from "./last-minute-list";

describe("lastMinuteEntryMatchesTripDate", () => {
  it("matches an entry with no dates given against any trip date", () => {
    expect(
      lastMinuteEntryMatchesTripDate({ availableFrom: null, availableUntil: null }, "2026-08-01"),
    ).toBe(true);
  });

  it("matches a trip date inside a bounded window", () => {
    expect(
      lastMinuteEntryMatchesTripDate(
        { availableFrom: "2026-07-25", availableUntil: "2026-08-05" },
        "2026-07-29",
      ),
    ).toBe(true);
  });

  it("rejects a trip date before the window starts", () => {
    expect(
      lastMinuteEntryMatchesTripDate(
        { availableFrom: "2026-08-01", availableUntil: null },
        "2026-07-29",
      ),
    ).toBe(false);
  });

  it("rejects a trip date after the window ends", () => {
    expect(
      lastMinuteEntryMatchesTripDate(
        { availableFrom: null, availableUntil: "2026-07-20" },
        "2026-07-29",
      ),
    ).toBe(false);
  });

  it("includes the boundary dates themselves", () => {
    const window = { availableFrom: "2026-07-29", availableUntil: "2026-07-29" };
    expect(lastMinuteEntryMatchesTripDate(window, "2026-07-29")).toBe(true);
  });
});

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
