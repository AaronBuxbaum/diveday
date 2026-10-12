import { describe, expect, it } from "vitest";
import {
  addMonths,
  clampMonth,
  compareMonths,
  isoDate,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "./calendar";

describe("isoDate", () => {
  it("keeps iso strings zero-padded and joinable", () => {
    expect(isoDate(2026, 1, 1)).toBe("2026-01-01");
    expect(isoDate(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("monthKey / parseMonthKey", () => {
  it("round-trips a month reference", () => {
    expect(monthKey({ year: 2026, month: 7 })).toBe("2026-07");
    expect(parseMonthKey("2026-07")).toEqual({ year: 2026, month: 7 });
  });

  it("rejects malformed or out-of-range keys", () => {
    expect(parseMonthKey("2026-7")).toBeNull();
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("2026-00")).toBeNull();
    expect(parseMonthKey("nonsense")).toBeNull();
    expect(parseMonthKey(undefined)).toBeNull();
    expect(parseMonthKey(null)).toBeNull();
  });
});

describe("addMonths", () => {
  it("advances within a year", () => {
    expect(addMonths({ year: 2026, month: 7 }, 1)).toEqual({ year: 2026, month: 8 });
  });

  it("rolls forward across the year boundary", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("rolls backward across the year boundary", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("handles multi-year jumps", () => {
    expect(addMonths({ year: 2026, month: 5 }, 25)).toEqual({ year: 2028, month: 6 });
    expect(addMonths({ year: 2026, month: 5 }, -25)).toEqual({ year: 2024, month: 4 });
  });
});

describe("monthLabel", () => {
  it("renders a human month and year", () => {
    expect(monthLabel({ year: 2026, month: 7 })).toBe("July 2026");
    expect(monthLabel({ year: 2026, month: 1 })).toBe("January 2026");
  });
});

describe("compareMonths", () => {
  it("orders by year first, then month", () => {
    expect(compareMonths({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBeLessThan(0);
    expect(compareMonths({ year: 2026, month: 3 }, { year: 2026, month: 2 })).toBeGreaterThan(0);
    expect(compareMonths({ year: 2026, month: 7 }, { year: 2026, month: 7 })).toBe(0);
  });
});

describe("clampMonth", () => {
  const floor = { year: 2026, month: 3 };
  const ceiling = { year: 2026, month: 8 };

  it("leaves a month inside the range alone", () => {
    expect(clampMonth({ year: 2026, month: 5 }, floor, ceiling)).toEqual({ year: 2026, month: 5 });
  });

  it("pulls a month before the floor up to it", () => {
    // The reports page's real defence: a `?month=0001-01` carried by a bookmark
    // or a crafted link lands on the shop's first month, not on the year 1.
    expect(clampMonth({ year: 1, month: 1 }, floor, ceiling)).toEqual(floor);
    expect(clampMonth({ year: 2026, month: 2 }, floor)).toEqual(floor);
  });

  it("pulls a month past the ceiling back to it", () => {
    expect(clampMonth({ year: 9999, month: 12 }, floor, ceiling)).toEqual(ceiling);
  });

  it("treats an omitted bound as unbounded on that side", () => {
    expect(clampMonth({ year: 9999, month: 12 }, floor)).toEqual({ year: 9999, month: 12 });
    expect(clampMonth({ year: 1, month: 1 }, null, ceiling)).toEqual({ year: 1, month: 1 });
  });

  it("keeps the boundary months themselves", () => {
    expect(clampMonth(floor, floor, ceiling)).toEqual(floor);
    expect(clampMonth(ceiling, floor, ceiling)).toEqual(ceiling);
  });
});
