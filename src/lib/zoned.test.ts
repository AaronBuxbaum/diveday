import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDayDelta,
  parseWallTime,
  shiftInstantByCalendarDays,
  utcToWallTime,
  wallTimeToUtc,
} from "./zoned";

describe("wallTimeToUtc", () => {
  it("converts summer wall time in New York (EDT, UTC-4)", () => {
    const utc = wallTimeToUtc(
      { year: 2026, month: 7, day: 18, hour: 7, minute: 30 },
      "America/New_York",
    );
    expect(utc.toISOString()).toBe("2026-07-18T11:30:00.000Z");
  });

  it("converts winter wall time in New York (EST, UTC-5)", () => {
    const utc = wallTimeToUtc(
      { year: 2026, month: 1, day: 15, hour: 7, minute: 30 },
      "America/New_York",
    );
    expect(utc.toISOString()).toBe("2026-01-15T12:30:00.000Z");
  });

  it("handles zones east of UTC", () => {
    const utc = wallTimeToUtc({ year: 2026, month: 7, day: 18, hour: 9, minute: 0 }, "Asia/Tokyo");
    expect(utc.toISOString()).toBe("2026-07-18T00:00:00.000Z");
  });

  it("handles UTC itself", () => {
    const utc = wallTimeToUtc({ year: 2026, month: 3, day: 1, hour: 12, minute: 0 }, "UTC");
    expect(utc.toISOString()).toBe("2026-03-01T12:00:00.000Z");
  });
});

describe("utcToWallTime", () => {
  it("is the inverse of wallTimeToUtc across a DST transition", () => {
    const beforeDst = wallTimeToUtc(
      { year: 2026, month: 3, day: 7, hour: 7, minute: 30 },
      "America/New_York",
    );
    expect(utcToWallTime(beforeDst, "America/New_York")).toEqual({
      year: 2026,
      month: 3,
      day: 7,
      hour: 7,
      minute: 30,
    });
    const afterDst = wallTimeToUtc(
      { year: 2026, month: 3, day: 9, hour: 7, minute: 30 },
      "America/New_York",
    );
    expect(utcToWallTime(afterDst, "America/New_York")).toEqual({
      year: 2026,
      month: 3,
      day: 9,
      hour: 7,
      minute: 30,
    });
  });
});

describe("addCalendarDays", () => {
  it("keeps hour/minute and rolls the date forward", () => {
    expect(addCalendarDays({ year: 2026, month: 3, day: 6, hour: 7, minute: 30 }, 7)).toEqual({
      year: 2026,
      month: 3,
      day: 13,
      hour: 7,
      minute: 30,
    });
  });

  it("rolls over a month/year boundary", () => {
    expect(addCalendarDays({ year: 2026, month: 12, day: 30, hour: 9, minute: 0 }, 3)).toEqual({
      year: 2027,
      month: 1,
      day: 2,
      hour: 9,
      minute: 0,
    });
  });

  it("handles negative deltas", () => {
    expect(addCalendarDays({ year: 2026, month: 3, day: 2, hour: 7, minute: 30 }, -5)).toEqual({
      year: 2026,
      month: 2,
      day: 25,
      hour: 7,
      minute: 30,
    });
  });
});

describe("calendarDayDelta", () => {
  it("counts whole calendar days between two wall dates, ignoring time-of-day", () => {
    expect(
      calendarDayDelta(
        { year: 2026, month: 3, day: 6, hour: 7, minute: 30 },
        { year: 2026, month: 3, day: 13, hour: 9, minute: 0 },
      ),
    ).toBe(7);
  });

  it("returns a negative delta when moving earlier", () => {
    expect(
      calendarDayDelta(
        { year: 2026, month: 3, day: 13, hour: 7, minute: 30 },
        { year: 2026, month: 3, day: 6, hour: 7, minute: 30 },
      ),
    ).toBe(-7);
  });

  it("is zero for the same calendar day even with different times", () => {
    expect(
      calendarDayDelta(
        { year: 2026, month: 3, day: 6, hour: 7, minute: 30 },
        { year: 2026, month: 3, day: 6, hour: 22, minute: 0 },
      ),
    ).toBe(0);
  });
});

describe("shiftInstantByCalendarDays", () => {
  it("preserves the New York wall-clock hour across the spring-forward transition", () => {
    // A 3-day course's second morning, published 07:30 EST on March 7 2026 —
    // the day before New York springs forward (2am -> 3am on March 8).
    const dayTwo = wallTimeToUtc(
      { year: 2026, month: 3, day: 7, hour: 7, minute: 30 },
      "America/New_York",
    );
    expect(dayTwo.toISOString()).toBe("2026-03-07T12:30:00.000Z"); // EST, UTC-5

    // Moved 7 days later, landing after the transition — a naive millisecond
    // shift would keep the UTC instant fixed at 12:30Z, which reads as 08:30
    // EDT and drifts the published 07:30 by an hour.
    const shifted = shiftInstantByCalendarDays(dayTwo, 7, "America/New_York");
    expect(utcToWallTime(shifted, "America/New_York")).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
    expect(shifted.toISOString()).toBe("2026-03-14T11:30:00.000Z"); // EDT, UTC-4
  });

  it("is a no-op for a zero-day shift", () => {
    const instant = new Date("2026-03-07T12:30:00.000Z");
    expect(shiftInstantByCalendarDays(instant, 0, "America/New_York")).toBe(instant);
  });
});

describe("parseWallTime", () => {
  it("parses valid date and time inputs", () => {
    expect(parseWallTime("2026-07-18", "07:30")).toEqual({
      year: 2026,
      month: 7,
      day: 18,
      hour: 7,
      minute: 30,
    });
  });

  it("rejects malformed or out-of-range values", () => {
    expect(parseWallTime("2026-7-18", "07:30")).toBeNull();
    expect(parseWallTime("2026-07-18", "7:30")).toBeNull();
    expect(parseWallTime("2026-13-01", "07:30")).toBeNull();
    expect(parseWallTime("2026-07-18", "24:00")).toBeNull();
    expect(parseWallTime("", "")).toBeNull();
  });
});
