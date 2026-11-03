import { describe, expect, it } from "vitest";
import { shopDayOf } from "./shop-day";

const TZ = "America/New_York";

describe("shopDayOf", () => {
  it("names the day the shop's own wall clock is in, not UTC's", () => {
    // 23:30 local on Aug 4 is 03:30 UTC on Aug 5.
    expect(shopDayOf(new Date("2026-08-05T03:30:00Z"), TZ)).toBe("2026-08-04");
  });

  it("holds the day through both 2026 clock changes in New York", () => {
    // 25-hour day: 23:30 EST on Nov 1 is 04:30Z on Nov 2.
    expect(shopDayOf(new Date("2026-11-02T04:30:00Z"), TZ)).toBe("2026-11-01");
    expect(shopDayOf(new Date("2026-11-02T05:00:00Z"), TZ)).toBe("2026-11-02");
    // 23-hour day: 23:30 EDT on Mar 8 is 03:30Z on Mar 9.
    expect(shopDayOf(new Date("2026-03-09T03:30:00Z"), TZ)).toBe("2026-03-08");
    expect(shopDayOf(new Date("2026-03-09T04:00:00Z"), TZ)).toBe("2026-03-09");
  });
});
