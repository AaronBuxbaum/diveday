import { describe, expect, it } from "vitest";
import {
  addDaysToWall,
  isValidWeeklyRecurrence,
  MAX_SERIES_OCCURRENCES,
  recurrenceSummary,
  weeklyOccurrences,
  weeklyOccurrencesAfter,
} from "./recurrence";
import type { WallTime } from "./zoned";
import { utcToWallTime, wallTimeToUtc } from "./zoned";

const wall = (year: number, month: number, day: number, hour = 7, minute = 30): WallTime => ({
  year,
  month,
  day,
  hour,
  minute,
});

describe("addDaysToWall", () => {
  it("rolls over month and year boundaries", () => {
    expect(addDaysToWall(wall(2026, 1, 30), 3)).toEqual(wall(2026, 2, 2));
    expect(addDaysToWall(wall(2026, 12, 30), 5)).toEqual(wall(2027, 1, 4));
  });

  it("preserves the wall-clock time of day", () => {
    const result = addDaysToWall(wall(2026, 7, 4, 6, 15), 7);
    expect(result.hour).toBe(6);
    expect(result.minute).toBe(15);
  });

  it("handles a leap day", () => {
    expect(addDaysToWall(wall(2028, 2, 28), 1)).toEqual(wall(2028, 2, 29));
  });
});

describe("weeklyOccurrences", () => {
  it("generates the requested number of weekly instances starting from the first", () => {
    const occurrences = weeklyOccurrences(
      { start: wall(2026, 7, 4), end: wall(2026, 7, 4, 12, 0) },
      { frequency: "weekly", intervalWeeks: 1, occurrenceCount: 4 },
    );
    expect(occurrences).not.toBeNull();
    expect(occurrences).toHaveLength(4);
    expect(occurrences?.[0]?.start).toEqual(wall(2026, 7, 4));
    expect(occurrences?.map((o) => o.start.day)).toEqual([4, 11, 18, 25]);
    // The end time-of-day rides along unchanged.
    expect(occurrences?.[3]?.end).toEqual(wall(2026, 7, 25, 12, 0));
  });

  it("respects the interval for every-other-week series", () => {
    const occurrences = weeklyOccurrences(
      { start: wall(2026, 7, 4), end: wall(2026, 7, 4, 12, 0) },
      { frequency: "weekly", intervalWeeks: 2, occurrenceCount: 3 },
    );
    expect(occurrences?.map((o) => `${o.start.month}-${o.start.day}`)).toEqual([
      "7-4",
      "7-18",
      "8-1",
    ]);
  });

  it("keeps the shop-local departure time constant across a daylight-saving change", () => {
    // US spring-forward is 2026-03-08. A 7:30 Saturday charter must stay 7:30
    // local on both sides of the transition even though the UTC offset shifts.
    const tz = "America/New_York";
    const occurrences = weeklyOccurrences(
      { start: wall(2026, 3, 7), end: wall(2026, 3, 7, 12, 0) },
      { frequency: "weekly", intervalWeeks: 1, occurrenceCount: 2 },
    );
    const before = wallTimeToUtc(occurrences?.[0]?.start as WallTime, tz);
    const after = wallTimeToUtc(occurrences?.[1]?.start as WallTime, tz);
    expect(utcToWallTime(before, tz).hour).toBe(7);
    expect(utcToWallTime(after, tz).hour).toBe(7);
    // The wall time is identical but the UTC instants are not 7 clean days apart:
    // the spring-forward hour is missing, so the gap is 7 days minus one hour.
    const days = (after.getTime() - before.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7 - 1 / 24, 5);
  });

  it("rejects an out-of-bounds recurrence rather than generating a runaway series", () => {
    expect(
      weeklyOccurrences(
        { start: wall(2026, 7, 4), end: wall(2026, 7, 4, 12, 0) },
        { frequency: "weekly", intervalWeeks: 1, occurrenceCount: MAX_SERIES_OCCURRENCES + 1 },
      ),
    ).toBeNull();
    expect(
      weeklyOccurrences(
        { start: wall(2026, 7, 4), end: wall(2026, 7, 4, 12, 0) },
        { frequency: "weekly", intervalWeeks: 1, occurrenceCount: 1 },
      ),
    ).toBeNull();
  });
});

describe("weeklyOccurrencesAfter", () => {
  it("generates the next N dates strictly after the anchor, on the same cadence", () => {
    const occurrences = weeklyOccurrencesAfter(
      { start: wall(2026, 7, 25), end: wall(2026, 7, 25, 12, 0) },
      1,
      3,
    );
    expect(occurrences).not.toBeNull();
    // The anchor (25th) is never repeated — extension starts one interval on.
    expect(occurrences?.map((o) => `${o.start.month}-${o.start.day}`)).toEqual([
      "8-1",
      "8-8",
      "8-15",
    ]);
    expect(occurrences?.[2]?.end).toEqual(wall(2026, 8, 15, 12, 0));
  });

  it("respects the interval when rolling an every-other-week series forward", () => {
    const occurrences = weeklyOccurrencesAfter(
      { start: wall(2026, 8, 1), end: wall(2026, 8, 1, 12, 0) },
      2,
      2,
    );
    expect(occurrences?.map((o) => `${o.start.month}-${o.start.day}`)).toEqual(["8-15", "8-29"]);
  });

  it("rejects an out-of-bounds interval or count", () => {
    const anchor = { start: wall(2026, 8, 1), end: wall(2026, 8, 1, 12, 0) };
    expect(weeklyOccurrencesAfter(anchor, 0, 3)).toBeNull();
    expect(weeklyOccurrencesAfter(anchor, 1, 0)).toBeNull();
    expect(weeklyOccurrencesAfter(anchor, 1, MAX_SERIES_OCCURRENCES + 1)).toBeNull();
  });
});

describe("isValidWeeklyRecurrence", () => {
  it("bounds the interval and count", () => {
    expect(
      isValidWeeklyRecurrence({ frequency: "weekly", intervalWeeks: 1, occurrenceCount: 8 }),
    ).toBe(true);
    expect(
      isValidWeeklyRecurrence({ frequency: "weekly", intervalWeeks: 0, occurrenceCount: 8 }),
    ).toBe(false);
    expect(
      isValidWeeklyRecurrence({ frequency: "weekly", intervalWeeks: 1.5, occurrenceCount: 8 }),
    ).toBe(false);
    expect(
      isValidWeeklyRecurrence({ frequency: "weekly", intervalWeeks: 1, occurrenceCount: 100 }),
    ).toBe(false);
  });
});

describe("recurrenceSummary", () => {
  it("reads naturally for weekly and multi-week cadences", () => {
    expect(recurrenceSummary({ frequency: "weekly", intervalWeeks: 1, occurrenceCount: 8 })).toBe(
      "Repeats weekly · 8 trips",
    );
    expect(recurrenceSummary({ frequency: "weekly", intervalWeeks: 2, occurrenceCount: 6 })).toBe(
      "Repeats every 2 weeks · 6 trips",
    );
  });
});
