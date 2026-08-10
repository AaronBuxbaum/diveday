import { describe, expect, it } from "vitest";
import {
  addDaysToWall,
  EVERY_WEEKDAY,
  isValidWeeklyPattern,
  MAX_OCCURRENCES_PER_ROLL,
  recurrenceSummary,
  seriesOccurrenceDates,
  weekdaySetFrom,
  weekdaySetHas,
  weekdaysIn,
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

/** 2026-07-04 is a Saturday; the fixtures below lean on that anchor throughout. */
const SATURDAY = "2026-07-04";
const SUN = 0;
const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const SAT = 6;

const dates = (window: Parameters<typeof seriesOccurrenceDates>[0]) =>
  seriesOccurrenceDates(window) ?? [];

describe("weekday sets", () => {
  it("round-trips a set of days through the bitmask", () => {
    expect(weekdaysIn(weekdaySetFrom([MON, THU]))).toEqual([MON, THU]);
    expect(weekdaysIn(EVERY_WEEKDAY)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("ignores day numbers that are not weekdays", () => {
    expect(weekdaysIn(weekdaySetFrom([MON, 7, -1, 3.5]))).toEqual([MON]);
  });

  it("answers membership without a lookup table", () => {
    const set = weekdaySetFrom([TUE, SAT]);
    expect(weekdaySetHas(set, TUE)).toBe(true);
    expect(weekdaySetHas(set, WED)).toBe(false);
  });
});

describe("isValidWeeklyPattern", () => {
  it("refuses a cadence with no days at all", () => {
    // The refusal that matters most: an empty set would generate silently
    // nothing, so a series would be created with no dates and no complaint.
    expect(isValidWeeklyPattern({ intervalWeeks: 1, weekdays: 0 })).toBe(false);
  });

  it("refuses an interval outside the supported bounds", () => {
    const weekdays = weekdaySetFrom([SAT]);
    expect(isValidWeeklyPattern({ intervalWeeks: 0, weekdays })).toBe(false);
    expect(isValidWeeklyPattern({ intervalWeeks: 9, weekdays })).toBe(false);
    expect(isValidWeeklyPattern({ intervalWeeks: 1.5, weekdays })).toBe(false);
    expect(isValidWeeklyPattern({ intervalWeeks: 8, weekdays })).toBe(true);
  });
});

describe("seriesOccurrenceDates", () => {
  it("fires on the anchor's own weekday, week after week", () => {
    expect(
      dates({
        anchorDate: SATURDAY,
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
        from: SATURDAY,
        through: "2026-07-25",
      }),
    ).toEqual(["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"]);
  });

  it("fires on every selected weekday — Monday and Thursday is one series", () => {
    expect(
      dates({
        anchorDate: "2026-07-06", // a Monday
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([MON, THU]) },
        from: "2026-07-06",
        through: "2026-07-19",
      }),
    ).toEqual(["2026-07-06", "2026-07-09", "2026-07-13", "2026-07-16"]);
  });

  it("treats every day of the week as the daily cadence", () => {
    expect(
      dates({
        anchorDate: "2026-07-06",
        pattern: { intervalWeeks: 1, weekdays: EVERY_WEEKDAY },
        from: "2026-07-06",
        through: "2026-07-12",
      }),
    ).toHaveLength(7);
  });

  it("counts the interval in whole weeks from the anchor's own week", () => {
    expect(
      dates({
        anchorDate: SATURDAY,
        pattern: { intervalWeeks: 2, weekdays: weekdaySetFrom([SAT]) },
        from: SATURDAY,
        through: "2026-08-15",
      }),
    ).toEqual(["2026-07-04", "2026-07-18", "2026-08-01", "2026-08-15"]);
  });

  it("keeps a multi-day week together when the interval skips weeks", () => {
    // Monday and Thursday of the *same* fortnight, not alternating days —
    // the phase is a property of the week, never of the individual date.
    expect(
      dates({
        anchorDate: "2026-07-06",
        pattern: { intervalWeeks: 2, weekdays: weekdaySetFrom([MON, THU]) },
        from: "2026-07-06",
        through: "2026-07-26",
      }),
    ).toEqual(["2026-07-06", "2026-07-09", "2026-07-20", "2026-07-23"]);
  });

  it("holds the every-other-week phase across a Sunday, where the week rolls", () => {
    // A Sunday-plus-Monday fortnightly run: Sunday closes one calendar week
    // and Monday opens the next, so a naive "days since the anchor, mod 14"
    // would drop the Mondays entirely.
    expect(
      dates({
        anchorDate: "2026-07-05", // a Sunday
        pattern: { intervalWeeks: 2, weekdays: weekdaySetFrom([SUN, MON]) },
        from: "2026-07-05",
        through: "2026-07-27",
      }),
    ).toEqual(["2026-07-05", "2026-07-06", "2026-07-19", "2026-07-20"]);
  });

  it("never proposes a date before the anchor, however wide the window", () => {
    expect(
      dates({
        anchorDate: SATURDAY,
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
        from: "2026-06-01",
        through: "2026-07-11",
      }),
    ).toEqual(["2026-07-04", "2026-07-11"]);
  });

  it("starts on the first selected weekday after an anchor that is not one", () => {
    // A shop that opens the panel on a Wednesday and picks Mon+Thu gets its
    // first departure that Thursday. The Wednesday only sets the phase.
    expect(
      dates({
        anchorDate: "2026-07-08", // a Wednesday
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([MON, THU]) },
        from: "2026-07-08",
        through: "2026-07-14",
      }),
    ).toEqual(["2026-07-09", "2026-07-13"]);
  });

  it("stops at the end date, even when the window runs past it", () => {
    expect(
      dates({
        anchorDate: SATURDAY,
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
        from: SATURDAY,
        through: "2026-08-29",
        endsOn: "2026-07-18",
      }),
    ).toEqual(["2026-07-04", "2026-07-11", "2026-07-18"]);
  });

  it("yields nothing once the end date is behind the window", () => {
    expect(
      dates({
        anchorDate: SATURDAY,
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
        from: "2026-09-01",
        through: "2026-12-01",
        endsOn: "2026-07-18",
      }),
    ).toEqual([]);
  });

  it("rolls month and year boundaries without drifting", () => {
    expect(
      dates({
        anchorDate: "2026-12-26", // a Saturday
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
        from: "2026-12-26",
        through: "2027-01-16",
      }),
    ).toEqual(["2026-12-26", "2027-01-02", "2027-01-09", "2027-01-16"]);
  });

  it("includes a leap day the cadence lands on", () => {
    expect(
      dates({
        anchorDate: "2028-02-22", // a Tuesday
        pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([TUE]) },
        from: "2028-02-22",
        through: "2028-03-07",
      }),
    ).toEqual(["2028-02-22", "2028-02-29", "2028-03-07"]);
  });

  it("refuses an unusable cadence rather than quietly generating nothing", () => {
    expect(
      seriesOccurrenceDates({
        anchorDate: SATURDAY,
        pattern: { intervalWeeks: 1, weekdays: 0 },
        from: SATURDAY,
        through: "2026-08-01",
      }),
    ).toBeNull();
  });

  it("is idempotent — the same window always proposes the same dates", () => {
    const window = {
      anchorDate: SATURDAY,
      pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
      from: "2026-07-01",
      through: "2026-09-01",
    };
    // The whole horizon-roll design rests on this: a nightly pass re-asks the
    // same question and creates only what is missing.
    expect(dates(window)).toEqual(dates(window));
  });

  it("caps a runaway window rather than materializing years of dates", () => {
    const proposed = dates({
      anchorDate: "2026-01-01",
      pattern: { intervalWeeks: 1, weekdays: EVERY_WEEKDAY },
      from: "2026-01-01",
      through: "2036-01-01",
    });
    expect(proposed).toHaveLength(MAX_OCCURRENCES_PER_ROLL);
  });
});

describe("occurrences through a timezone", () => {
  it("keeps the local departure time constant across a DST change", () => {
    // US DST ends 2026-11-01; a 7:30 Saturday charter stays 7:30 local on
    // both sides, which is what the shop published and the diver reads.
    const proposed = dates({
      anchorDate: "2026-10-24",
      pattern: { intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]) },
      from: "2026-10-24",
      through: "2026-11-07",
    });
    const local = proposed.map((date) => {
      const [year, month, day] = date.split("-").map(Number);
      const instant = wallTimeToUtc({ year, month, day, hour: 7, minute: 30 }, "America/New_York");
      return utcToWallTime(instant, "America/New_York").hour;
    });
    expect(local).toEqual([7, 7, 7]);
  });
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

describe("recurrenceSummary", () => {
  it("reads a single-day weekly run as weekly", () => {
    expect(
      recurrenceSummary({ intervalWeeks: 1, weekdays: weekdaySetFrom([SAT]), endsOn: null }),
    ).toEqual({ cadence: "weekly", intervalWeeks: 1, weekdays: [SAT], endsOn: null });
  });

  it("reads all seven days as daily rather than as seven weekly days", () => {
    expect(
      recurrenceSummary({ intervalWeeks: 1, weekdays: EVERY_WEEKDAY, endsOn: null }).cadence,
    ).toBe("daily");
  });

  it("keeps every-N-weeks distinct even when it names all seven days", () => {
    expect(
      recurrenceSummary({ intervalWeeks: 2, weekdays: EVERY_WEEKDAY, endsOn: null }).cadence,
    ).toBe("everyNWeeks");
  });

  it("carries the end date through, and null for a run that keeps going", () => {
    const weekdays = weekdaySetFrom([MON, THU]);
    expect(recurrenceSummary({ intervalWeeks: 1, weekdays, endsOn: "2026-11-30" }).endsOn).toBe(
      "2026-11-30",
    );
    expect(recurrenceSummary({ intervalWeeks: 1, weekdays }).endsOn).toBeNull();
  });
});
