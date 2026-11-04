import { describe, expect, it } from "vitest";
import {
  isTripDayCount,
  laterMeetingDates,
  MAX_MEETING_DAY_GAP_DAYS,
  MAX_TRIP_DAYS,
  MAX_TRIP_SPAN_DAYS,
  meetingDaysFor,
  meetingDayWindows,
  onTheWaterDay,
  rollCallDayOf,
  rollCallDayStarts,
  rollCallRecordSince,
  tripMeetingDays,
} from "./trip-days";
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

/**
 * **A date per day** (third UX review, item 10): an Open Water course that
 * meets Sat/Sun, Sat/Sun, Sat is one trip with five named days, not three
 * trips that share a title.
 */
describe("meetingDaysFor", () => {
  const saturday = { start: wall(2026, 10, 24, 8, 0), end: wall(2026, 10, 24, 16, 0) };

  it("is the consecutive run when no dates are named", () => {
    expect(meetingDaysFor(saturday, 2)).toEqual({ ok: true, days: tripMeetingDays(saturday, 2) });
  });

  it("puts day one's window on every named date that follows the day before it", () => {
    const result = meetingDaysFor(saturday, 3, ["2026-10-25", "2026-10-26"]);
    expect(result.ok && result.days.map((d) => [d.start, d.end])).toEqual([
      [wall(2026, 10, 24, 8, 0), wall(2026, 10, 24, 16, 0)],
      [wall(2026, 10, 25, 8, 0), wall(2026, 10, 25, 16, 0)],
      [wall(2026, 10, 26, 8, 0), wall(2026, 10, 26, 16, 0)],
    ]);
  });

  /**
   * Today, the open roll call, check-in and boarding read a departure's day as
   * its one `startsAt`..`endsAt` window. A course on Saturday and the Saturday
   * two weeks on would read as a boat on the water with an open roll call for
   * the thirteen days between, and would not be today's departure on its second
   * day. Until those read the meeting days, a departure's days run back to back.
   */
  it("refuses a gap between meeting days, a two-week one included", () => {
    expect(MAX_MEETING_DAY_GAP_DAYS).toBe(1);
    expect(meetingDaysFor(saturday, 2, ["2026-11-07"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
    expect(meetingDaysFor(saturday, 3, ["2026-10-25", "2026-10-31"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
    expect(meetingDaysFor(saturday, 2, ["2026-10-26"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
  });

  it("keeps a window that ends after midnight ending the morning after its own date", () => {
    const night = { start: wall(2026, 10, 24, 20, 0), end: wall(2026, 10, 25, 1, 0) };
    const result = meetingDaysFor(night, 2, ["2026-10-25"]);
    expect(result.ok && result.days[1]).toEqual({
      start: wall(2026, 10, 25, 20, 0),
      end: wall(2026, 10, 26, 1, 0),
    });
  });

  it("refuses dates out of order, on day one, or far past it, with a sentence of their own", () => {
    expect(meetingDaysFor(saturday, 2, ["2026-10-24"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
    expect(meetingDaysFor(saturday, 3, ["2026-10-31", "2026-10-25"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
    expect(meetingDaysFor(saturday, 2, ["2026-10-23"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
    // Six weeks stays the outer bound for the day gaps open again.
    expect(meetingDaysFor(saturday, 2, ["2026-12-06"])).toEqual({
      ok: false,
      reason: "days_out_of_order",
    });
    expect(MAX_TRIP_SPAN_DAYS).toBe(42);
  });

  it("refuses a list that disagrees with the count, or a day that does not exist", () => {
    expect(meetingDaysFor(saturday, 3, ["2026-10-25"])).toEqual({ ok: false, reason: "invalid" });
    expect(meetingDaysFor(saturday, 2, ["2026-02-31"])).toEqual({ ok: false, reason: "invalid" });
    expect(meetingDaysFor(saturday, 0)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("laterMeetingDates", () => {
  it("says nothing for consecutive days, which the count already says", () => {
    expect(laterMeetingDates(["2026-10-24", "2026-10-25", "2026-10-26"])).toEqual([]);
    expect(laterMeetingDates(["2026-10-24"])).toEqual([]);
  });

  it("names every later day once the run has a gap", () => {
    expect(laterMeetingDates(["2026-10-24", "2026-10-25", "2026-10-31"])).toEqual([
      "2026-10-25",
      "2026-10-31",
    ]);
  });
});

describe("roll-call days (#2557)", () => {
  // Saturday Aug 1 and Saturday Aug 15 2026, 09:00 to 13:00 EDT.
  const satOne = {
    startsAt: new Date("2026-08-01T13:00:00.000Z"),
    endsAt: new Date("2026-08-01T17:00:00.000Z"),
  };
  const satTwo = {
    startsAt: new Date("2026-08-15T13:00:00.000Z"),
    endsAt: new Date("2026-08-15T17:00:00.000Z"),
  };
  const run = { startsAt: satOne.startsAt, endsAt: satTwo.endsAt };
  const days = meetingDayWindows(run, [satTwo, satOne]);

  it("orders the days, and reads a trip with none as its one window", () => {
    expect(days).toEqual([satOne, satTwo]);
    expect(meetingDayWindows(run, [])).toEqual([run]);
  });

  it("gives Saturday's late count to Saturday and the second Saturday's boarding to it", () => {
    const starts = rollCallDayStarts(days);
    expect(rollCallDayOf(starts, new Date("2026-08-01T23:00:00.000Z"))).toBe(0);
    expect(rollCallDayOf(starts, new Date("2026-08-15T12:30:00.000Z"))).toBe(1);
    expect(rollCallDayOf(starts, new Date("2026-08-15T16:00:00.000Z"))).toBe(1);
  });

  it("never starts a day after its own window opens, even when windows touch", () => {
    const touching = [
      {
        startsAt: new Date("2026-08-01T13:00:00.000Z"),
        endsAt: new Date("2026-08-01T15:00:00.000Z"),
      },
      {
        startsAt: new Date("2026-08-01T14:00:00.000Z"),
        endsAt: new Date("2026-08-01T17:00:00.000Z"),
      },
    ];
    expect(rollCallDayStarts(touching)[1]).toBeLessThanOrEqual(
      Date.parse("2026-08-01T14:00:00.000Z"),
    );
  });

  it("keeps a one-day trip's whole record on its one day", () => {
    expect(rollCallRecordSince([run], new Date("2027-01-01T00:00:00.000Z"))).toBeNull();
    expect(rollCallDayStarts([run])).toEqual([Number.NEGATIVE_INFINITY]);
  });

  it("starts the second Saturday's record empty, halfway through the fortnight", () => {
    expect(rollCallRecordSince(days, new Date("2026-08-02T14:00:00.000Z"))).toBeNull();
    const since = rollCallRecordSince(days, new Date("2026-08-15T14:00:00.000Z"));
    expect(since?.toISOString()).toBe("2026-08-08T15:00:00.000Z");
  });

  it("is on the water only inside a day and its return hour, never between", () => {
    expect(onTheWaterDay(days, new Date("2026-08-01T14:00:00.000Z"))).toEqual(satOne);
    expect(onTheWaterDay(days, new Date("2026-08-01T17:59:00.000Z"))).toEqual(satOne);
    expect(onTheWaterDay(days, new Date("2026-08-01T18:00:00.000Z"))).toBeNull();
    expect(onTheWaterDay(days, new Date("2026-08-08T14:00:00.000Z"))).toBeNull();
    expect(onTheWaterDay(days, new Date("2026-08-15T14:00:00.000Z"))).toEqual(satTwo);
  });
});
