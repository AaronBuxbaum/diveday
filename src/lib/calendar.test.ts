import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildCalendarWeeks,
  isoDate,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "./calendar";

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

describe("buildCalendarWeeks", () => {
  it("produces a six-week, Sunday-first grid", () => {
    const weeks = buildCalendarWeeks({ year: 2026, month: 7 });
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    for (const week of weeks) expect(week[0].weekday).toBe(0);
  });

  it("places the first of the month on the correct weekday", () => {
    // 1 July 2026 is a Wednesday (weekday 3).
    const weeks = buildCalendarWeeks({ year: 2026, month: 7 });
    const first = weeks.flat().find((d) => d.inMonth && d.day === 1);
    expect(first?.weekday).toBe(3);
    // The three leading cells spill in from June.
    expect(weeks[0][0]).toMatchObject({ month: 6, day: 28, inMonth: false });
    expect(weeks[0][3]).toMatchObject({ month: 7, day: 1, inMonth: true });
  });

  it("marks spill-in days from adjacent months as out-of-month", () => {
    const weeks = buildCalendarWeeks({ year: 2026, month: 7 });
    const inMonth = weeks.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31); // July has 31 days
    expect(inMonth.every((d) => d.month === 7 && d.year === 2026)).toBe(true);
    const trailing = weeks.flat().filter((d) => !d.inMonth && d.month === 8);
    expect(trailing.length).toBeGreaterThan(0);
  });

  it("keeps iso strings zero-padded and joinable", () => {
    const weeks = buildCalendarWeeks({ year: 2026, month: 1 });
    const first = weeks.flat().find((d) => d.inMonth && d.day === 1);
    expect(first?.iso).toBe("2026-01-01");
    expect(isoDate(2026, 1, 1)).toBe("2026-01-01");
  });

  it("handles a month whose first day is Sunday without a blank leading week", () => {
    // 1 February 2026 is a Sunday.
    const weeks = buildCalendarWeeks({ year: 2026, month: 2 });
    expect(weeks[0][0]).toMatchObject({ month: 2, day: 1, inMonth: true, weekday: 0 });
  });
});
