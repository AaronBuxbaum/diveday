import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildCalendarWeeks,
  isoDate,
  monthKey,
  monthLabel,
  parseMonthKey,
  weekStartsOn,
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

  it("builds a Monday-first grid when asked", () => {
    // 1 July 2026 is a Wednesday (weekday 3); a Monday-first week starts two
    // days earlier than the Sunday-first grid above.
    const weeks = buildCalendarWeeks({ year: 2026, month: 7 }, 1);
    expect(weeks[0][0]).toMatchObject({ weekday: 1, month: 6, day: 29, inMonth: false });
    expect(weeks[0][1]).toMatchObject({ weekday: 2, month: 6, day: 30, inMonth: false });
    expect(weeks[0][2]).toMatchObject({ weekday: 3, month: 7, day: 1, inMonth: true });
  });
});

describe("weekStartsOn", () => {
  it("falls back to Sunday where the runtime's ICU build has no week info", () => {
    const proto = Intl.Locale.prototype as { getWeekInfo?: () => Intl.WeekInfo };
    const original = proto.getWeekInfo;
    delete proto.getWeekInfo;
    try {
      expect(weekStartsOn("es-ES")).toBe(0);
      expect(weekStartsOn("en-US")).toBe(0);
    } finally {
      proto.getWeekInfo = original;
    }
  });

  it("converts ISO 8601 firstDay (1 = Monday … 7 = Sunday) to 0-Sunday indexing", () => {
    const proto = Intl.Locale.prototype;
    const original = proto.getWeekInfo;
    proto.getWeekInfo = function stubGetWeekInfo(this: Intl.Locale): Intl.WeekInfo {
      return { firstDay: this.baseName === "es-ES" ? 1 : 7, weekend: [6, 7] };
    };
    try {
      expect(weekStartsOn("es-ES")).toBe(1);
      expect(weekStartsOn("en-US")).toBe(0);
    } finally {
      proto.getWeekInfo = original;
    }
  });
});
