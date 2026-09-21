import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDayNoons,
  dayHourBoundaries,
  parseWallTime,
  shiftInstantByCalendarDays,
  shiftInstantByWallTimeDelta,
  utcToWallTime,
  wallTimeDeltaMs,
  wallTimeToUtc,
  zonedIsoString,
} from "./zoned";

describe("zonedIsoString", () => {
  it("writes the wall clock with the zone's offset, never a Z", () => {
    // 11:30Z is 07:30 in New York on a July morning (EDT, UTC-4)…
    expect(zonedIsoString(new Date("2026-07-25T11:30:00Z"), "America/New_York")).toBe(
      "2026-07-25T07:30:00-04:00",
    );
    // …and 06:30 there in January (EST, UTC-5).
    expect(zonedIsoString(new Date("2026-01-25T11:30:00Z"), "America/New_York")).toBe(
      "2026-01-25T06:30:00-05:00",
    );
  });

  it("carries a positive offset, a half-hour zone, and UTC itself as written", () => {
    expect(zonedIsoString(new Date("2026-07-25T02:00:00Z"), "Asia/Kolkata")).toBe(
      "2026-07-25T07:30:00+05:30",
    );
    expect(zonedIsoString(new Date("2026-07-25T02:00:00Z"), "UTC")).toBe(
      "2026-07-25T02:00:00+00:00",
    );
  });

  it("rolls the calendar date with the zone", () => {
    // Late evening UTC is already tomorrow morning in Tokyo.
    expect(zonedIsoString(new Date("2026-07-25T22:15:00Z"), "Asia/Tokyo")).toBe(
      "2026-07-26T07:15:00+09:00",
    );
  });
});

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

describe("wallTimeDeltaMs", () => {
  it("is a whole-day multiple when only the date changes", () => {
    expect(
      wallTimeDeltaMs(
        { year: 2026, month: 3, day: 6, hour: 7, minute: 30 },
        { year: 2026, month: 3, day: 13, hour: 7, minute: 30 },
      ),
    ).toBe(7 * 86_400_000);
  });

  it("includes the time-of-day change alongside the day change", () => {
    // 2 days later, but 1h45m earlier in the day: net delta is (2 days - 1h45m).
    expect(
      wallTimeDeltaMs(
        { year: 2026, month: 6, day: 10, hour: 9, minute: 0 },
        { year: 2026, month: 6, day: 12, hour: 7, minute: 15 },
      ),
    ).toBe(2 * 86_400_000 - (1 * 3_600_000 + 45 * 60_000));
  });
});

describe("shiftInstantByWallTimeDelta", () => {
  it("preserves the New York wall-clock hour across the spring-forward transition (day-only delta)", () => {
    // Same regression as shiftInstantByCalendarDays: a pure whole-day delta
    // (no time-of-day component) must still land on the same wall-clock hour
    // across a DST transition, not drift by the offset change.
    const dayTwo = wallTimeToUtc(
      { year: 2026, month: 3, day: 7, hour: 7, minute: 30 },
      "America/New_York",
    );
    const deltaMs = wallTimeDeltaMs(
      { year: 2026, month: 3, day: 7, hour: 7, minute: 30 },
      { year: 2026, month: 3, day: 14, hour: 7, minute: 30 },
    );
    const shifted = shiftInstantByWallTimeDelta(dayTwo, deltaMs, "America/New_York");
    expect(utcToWallTime(shifted, "America/New_York")).toEqual({
      year: 2026,
      month: 3,
      day: 14,
      hour: 7,
      minute: 30,
    });
  });

  it("carries a time-of-day change through to a different instant", () => {
    // A trip's endsAt (13:00 on June 10) shifted by the same delta as a move
    // from 09:00 to 07:15 two days later must land at 11:15 on June 12 — the
    // original 4h duration preserved, not stuck at the old wall-clock hour.
    const endsAt = wallTimeToUtc(
      { year: 2026, month: 6, day: 10, hour: 13, minute: 0 },
      "America/New_York",
    );
    const deltaMs = wallTimeDeltaMs(
      { year: 2026, month: 6, day: 10, hour: 9, minute: 0 },
      { year: 2026, month: 6, day: 12, hour: 7, minute: 15 },
    );
    const shifted = shiftInstantByWallTimeDelta(endsAt, deltaMs, "America/New_York");
    expect(utcToWallTime(shifted, "America/New_York")).toEqual({
      year: 2026,
      month: 6,
      day: 12,
      hour: 11,
      minute: 15,
    });
  });

  it("is a no-op for a zero delta", () => {
    const instant = new Date("2026-03-07T12:30:00.000Z");
    expect(shiftInstantByWallTimeDelta(instant, 0, "America/New_York")).toBe(instant);
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

describe("dayHourBoundaries", () => {
  const NEW_YORK = "America/New_York";
  const day = (year: number, month: number, dayOfMonth: number) => ({
    from: wallTimeToUtc({ year, month, day: dayOfMonth, hour: 0, minute: 0 }, NEW_YORK),
    to: wallTimeToUtc({ year, month, day: dayOfMonth + 1, hour: 0, minute: 0 }, NEW_YORK),
  });

  it("gives an ordinary day all twenty-four of its hours, each reading its own", () => {
    const hours = dayHourBoundaries(day(2026, 7, 17), NEW_YORK);
    expect(hours).toHaveLength(24);
    expect(hours.map((hour) => hour.hour)).toEqual([...Array(24).keys()]);
  });

  /**
   * **The day a zone springs forward has twenty-three hours in it.** 2 AM never
   * happens in New York on 2026-03-08, and `wallTimeToUtc` resolves it forward
   * — so a caller asking for hours 0-23 gets `… 1, 3, 3, 4 …`, with two
   * requests answering the *same instant* and the entry at position two reading
   * three o'clock. Position is not the hour from there to midnight, and two
   * identical instants are two identical React keys.
   */
  it("drops the hour a spring-forward day does not have, and never repeats an instant", () => {
    const hours = dayHourBoundaries(day(2026, 3, 8), NEW_YORK);
    expect(hours).toHaveLength(23);
    expect(hours.map((hour) => hour.hour)).toEqual([
      0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    expect(new Set(hours.map((hour) => hour.at.getTime())).size).toBe(hours.length);
  });

  /**
   * The day it falls back has twenty-five, and 1 AM happens twice. One boundary
   * per clock hour is what a reader wants, so the second is not invented.
   */
  it("gives a fall-back day one boundary per clock hour", () => {
    const hours = dayHourBoundaries(day(2026, 11, 1), NEW_YORK);
    expect(hours.map((hour) => hour.hour)).toEqual([...Array(24).keys()]);
    expect(new Set(hours.map((hour) => hour.at.getTime())).size).toBe(hours.length);
  });

  /**
   * **A window that crosses midnight keeps its hours on both sides of it.**
   * The body used to build hours on the wall date of `from` alone, so a
   * departure running 10 PM to 10 AM answered `22, 23` and nothing after — and
   * the demo shop ships a three-day charter, whose voyage strip drew ticks for
   * the first evening and a bare line for the two days after it (found by
   * review on PR #1903).
   */
  it("covers every calendar day the window touches, not just the first", () => {
    const overnight = dayHourBoundaries(
      {
        from: wallTimeToUtc({ year: 2026, month: 7, day: 17, hour: 22, minute: 0 }, NEW_YORK),
        to: wallTimeToUtc({ year: 2026, month: 7, day: 18, hour: 10, minute: 0 }, NEW_YORK),
      },
      NEW_YORK,
    );
    expect(overnight.map((hour) => hour.hour)).toEqual([22, 23, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("walks a multi-day charter without repeating or skipping a day", () => {
    const threeDays = dayHourBoundaries(
      {
        from: wallTimeToUtc({ year: 2026, month: 7, day: 17, hour: 0, minute: 0 }, NEW_YORK),
        to: wallTimeToUtc({ year: 2026, month: 7, day: 20, hour: 0, minute: 0 }, NEW_YORK),
      },
      NEW_YORK,
    );
    expect(threeDays).toHaveLength(72);
    expect(new Set(threeDays.map((hour) => hour.at.getTime())).size).toBe(72);
  });

  /**
   * Stepping a calendar day from midnight is what breaks on a spring-forward
   * day: midnight plus twenty-four hours lands at 11 PM the *same* date, so the
   * walk repeats a day and never reaches the end. It steps from noon.
   */
  it("crosses a spring-forward boundary without stalling on the short day", () => {
    const acrossDst = dayHourBoundaries(
      {
        from: wallTimeToUtc({ year: 2026, month: 3, day: 7, hour: 22, minute: 0 }, NEW_YORK),
        to: wallTimeToUtc({ year: 2026, month: 3, day: 9, hour: 2, minute: 0 }, NEW_YORK),
      },
      NEW_YORK,
    );
    // 22, 23 on the 7th; the 8th's twenty-three hours; 0 and 1 on the 9th.
    expect(acrossDst).toHaveLength(27);
    expect(acrossDst.map((hour) => hour.hour).slice(0, 5)).toEqual([22, 23, 0, 1, 3]);
    expect(acrossDst.at(-1)?.hour).toBe(1);
  });

  it("reads each hour back from its instant rather than trusting the request", () => {
    for (const hour of dayHourBoundaries(day(2026, 3, 8), NEW_YORK)) {
      expect(utcToWallTime(hour.at, NEW_YORK).hour).toBe(hour.hour);
      expect(utcToWallTime(hour.at, NEW_YORK).minute).toBe(0);
    }
  });

  it("stays inside the day it was given", () => {
    const bounds = day(2026, 7, 17);
    for (const hour of dayHourBoundaries(bounds, NEW_YORK)) {
      expect(hour.at.getTime()).toBeGreaterThanOrEqual(bounds.from.getTime());
      expect(hour.at.getTime()).toBeLessThan(bounds.to.getTime());
    }
  });
});

/**
 * **Which calendar days a window touches**, for the almanac to be asked once
 * per day rather than once per hour (issue #1904 — a two-day course drew one
 * morning and a bare line where the second day's sun belonged).
 */
describe("noon on every calendar day a window touches", () => {
  const KEY_LARGO = "America/New_York";

  it("gives one noon for a window inside a single day", () => {
    const noons = calendarDayNoons(
      { from: new Date("2026-08-27T12:00:00Z"), to: new Date("2026-08-27T20:00:00Z") },
      KEY_LARGO,
    );
    expect(noons).toHaveLength(1);
    expect(utcToWallTime(noons[0], KEY_LARGO)).toMatchObject({
      year: 2026,
      month: 8,
      day: 27,
      hour: 12,
    });
  });

  it("gives two for a voyage that sails overnight", () => {
    // 08:00 Wednesday to 16:00 Thursday, in the shop's own zone — the seeded
    // two-day course, and the case the single pair could not draw.
    const noons = calendarDayNoons(
      { from: new Date("2026-08-26T12:00:00Z"), to: new Date("2026-08-27T20:00:00Z") },
      KEY_LARGO,
    );
    expect(noons.map((noon) => utcToWallTime(noon, KEY_LARGO).day)).toEqual([26, 27]);
  });

  it("counts a day the window only clips, not just the days it fills", () => {
    // 23:00 to 01:00 touches two dates and fills neither.
    const noons = calendarDayNoons(
      { from: new Date("2026-08-27T03:00:00Z"), to: new Date("2026-08-27T05:00:00Z") },
      KEY_LARGO,
    );
    expect(noons.map((noon) => utcToWallTime(noon, KEY_LARGO).day)).toEqual([26, 27]);
  });

  it("does not repeat or skip a day across a spring-forward", () => {
    // 2026-03-08 is the US spring-forward. Stepping a calendar day from
    // midnight would land at 11 PM the same date and stall the walk; this
    // steps from noon, which no clock change takes away.
    const noons = calendarDayNoons(
      { from: new Date("2026-03-07T17:00:00Z"), to: new Date("2026-03-10T17:00:00Z") },
      KEY_LARGO,
    );
    expect(noons.map((noon) => utcToWallTime(noon, KEY_LARGO).day)).toEqual([7, 8, 9, 10]);
  });

  it("answers nothing for a window with no width", () => {
    const instant = new Date("2026-08-27T12:00:00Z");
    expect(calendarDayNoons({ from: instant, to: instant }, KEY_LARGO)).toEqual([]);
  });
});
