import { describe, expect, it } from "vitest";
import { isTripDayCount, MAX_TRIP_DAYS, tripMeetingDays } from "./trip-days";
import type { WallTime } from "./zoned";

const wall = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): WallTime => ({ year, month, day, hour, minute });

const window = { start: wall(2026, 8, 14, 8, 30), end: wall(2026, 8, 14, 12, 30) };

describe("tripMeetingDays", () => {
  it("leaves a one-day trip exactly as it was handed in", () => {
    expect(tripMeetingDays(window, 1)).toEqual([window]);
  });

  it("repeats the same wall-clock window on consecutive calendar days", () => {
    expect(tripMeetingDays(window, 3)).toEqual([
      { start: wall(2026, 8, 14, 8, 30), end: wall(2026, 8, 14, 12, 30) },
      { start: wall(2026, 8, 15, 8, 30), end: wall(2026, 8, 15, 12, 30) },
      { start: wall(2026, 8, 16, 8, 30), end: wall(2026, 8, 16, 12, 30) },
    ]);
  });

  it("rolls over a month and a year boundary", () => {
    const newYear = { start: wall(2026, 12, 31, 7, 0), end: wall(2026, 12, 31, 11, 0) };
    expect(tripMeetingDays(newYear, 2)?.at(-1)).toEqual({
      start: wall(2027, 1, 1, 7, 0),
      end: wall(2027, 1, 1, 11, 0),
    });
  });

  it("keeps the promised wall-clock time across a DST change", () => {
    // US spring-forward is 8 March 2026. A shop that says "back at the dock at
    // 08:30" means 08:30 on both days — the day list is wall time, and the
    // conversion to an instant happens per day in the shop's own zone.
    const springForward = { start: wall(2026, 3, 7, 8, 30), end: wall(2026, 3, 7, 12, 30) };
    expect(tripMeetingDays(springForward, 2)?.at(-1)).toEqual({
      start: wall(2026, 3, 8, 8, 30),
      end: wall(2026, 3, 8, 12, 30),
    });
  });

  it("refuses a day count outside the supported range instead of guessing", () => {
    expect(tripMeetingDays(window, 0)).toBeNull();
    expect(tripMeetingDays(window, -1)).toBeNull();
    expect(tripMeetingDays(window, 1.5)).toBeNull();
    expect(tripMeetingDays(window, MAX_TRIP_DAYS + 1)).toBeNull();
    expect(tripMeetingDays(window, Number.NaN)).toBeNull();
  });

  /**
   * The property every multi-occurrence caller leans on: whether this refuses
   * depends on the **day count alone**, never on the day.
   *
   * A weekly series shifts one window forward week by week and asks for the
   * meeting days of each occurrence in turn (`addDepartureAction`). If a later
   * occurrence could refuse where the first succeeded — a DST week, a month or
   * year rollover, a leap day — the series would be half-shaped, so the caller
   * would have to decide what a partial answer means. It cannot: the day count
   * is one parsed value for the whole submission, and this pins that.
   */
  it("refuses on the day count alone, never on the day it lands on", () => {
    const awkwardDays = [
      wall(2026, 3, 7, 8, 30), // the day before US spring-forward
      wall(2026, 3, 8, 8, 30), // spring-forward itself
      wall(2026, 11, 1, 8, 30), // fall-back
      wall(2026, 12, 31, 8, 30), // year rollover
      wall(2026, 1, 31, 8, 30), // month rollover off a 31st
      wall(2028, 2, 29, 8, 30), // leap day
    ];
    for (const start of awkwardDays) {
      const day = { start, end: { ...start, hour: 12 } };
      // Valid count: an answer, every time, of exactly the length asked for.
      expect(tripMeetingDays(day, 3)).toHaveLength(3);
      expect(tripMeetingDays(day, MAX_TRIP_DAYS)).toHaveLength(MAX_TRIP_DAYS);
      // Invalid count: refused, every time, for the same reason.
      expect(tripMeetingDays(day, MAX_TRIP_DAYS + 1)).toBeNull();
      expect(tripMeetingDays(day, 0)).toBeNull();
    }
  });

  it("accepts the whole supported range", () => {
    expect(isTripDayCount(1)).toBe(true);
    expect(isTripDayCount(MAX_TRIP_DAYS)).toBe(true);
    expect(tripMeetingDays(window, MAX_TRIP_DAYS)).toHaveLength(MAX_TRIP_DAYS);
  });
});
