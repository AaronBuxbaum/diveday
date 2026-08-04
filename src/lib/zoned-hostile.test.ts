/**
 * The hostile-instants suite: every conversion in `zoned.ts` (and the two
 * day-semantics consumers beside it, `formatRelativeDay` and `dueReminder`)
 * pinned to the moments where timezone code actually breaks — the
 * spring-forward night whose 2:30am doesn't exist, the fall-back night whose
 * 1:30am exists twice, zones that jump *at midnight* so the shop day itself
 * starts or ends inside the gap, departures that cross midnight in shop-local
 * but not UTC (and vice versa), a week that is 167 or 169 hours long, and
 * zones whose offset is not a whole hour (including a *30-minute* DST shift).
 *
 * A dive shop lives on wall-clock time while the database lives in UTC;
 * `wallTimeToUtc`/`utcToWallTime` are the one sanctioned seam between them.
 * If date math bypasses that seam, one of these tables is built to fail.
 *
 * Fixed transition facts used below (IANA tzdb):
 * - America/New_York 2026: spring forward Mar 8 02:00→03:00 (07:00Z),
 *   fall back Nov 1 02:00→01:00 (06:00Z).
 * - America/Santiago 2026: springs forward *at midnight* — Sep 5 24:00 jumps
 *   to Sep 6 01:00 (04:00Z). Sep 6 has no 00:xx at all.
 * - Atlantic/Azores 2026: falls back Oct 25 01:00→00:00 (01:00Z) — midnight
 *   happens twice.
 * - Australia/Lord_Howe: UTC+10:30/+11:00 — DST moves the clock by THIRTY
 *   minutes (2026: forward Oct 4 02:00→02:30, back Apr 5 02:00→01:30).
 * - Pacific/Chatham: UTC+12:45/+13:45 — a 45-minute base offset with DST
 *   (2026: forward Sep 27 02:45→03:45).
 * - Asia/Kathmandu: UTC+05:45, no DST.
 */

import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "./calendar-date";
import { formatRelativeDay } from "./format";
import { dueReminder } from "./reminders";
import {
  addCalendarDays,
  shiftInstantByCalendarDays,
  shiftInstantByWallTimeDelta,
  shopDayBounds,
  utcToWallTime,
  type WallTime,
  wallTimeDeltaMs,
  wallTimeToUtc,
} from "./zoned";

const wall = (year: number, month: number, day: number, hour: number, minute = 0): WallTime => ({
  year,
  month,
  day,
  hour,
  minute,
});

describe("the spring-forward night: wall times that do not exist", () => {
  it.each([
    // [zone, nonexistent wall time, resolved UTC instant, what it reads back as]
    [
      "America/New_York", // 1-hour gap, west of UTC
      wall(2026, 3, 8, 2, 30),
      "2026-03-08T07:30:00.000Z",
      wall(2026, 3, 8, 3, 30),
    ],
    [
      "Australia/Lord_Howe", // THIRTY-minute gap, east of UTC
      wall(2026, 10, 4, 2, 15),
      "2026-10-03T15:45:00.000Z",
      wall(2026, 10, 4, 2, 45),
    ],
    [
      "Pacific/Chatham", // 1-hour gap on a 45-minute base offset
      wall(2026, 9, 27, 3, 0),
      "2026-09-26T14:15:00.000Z",
      wall(2026, 9, 27, 4, 0),
    ],
    [
      "America/Santiago", // the gap sits AT midnight: 00:30 does not exist
      wall(2026, 9, 6, 0, 30),
      "2026-09-06T04:30:00.000Z",
      wall(2026, 9, 6, 1, 30),
    ],
  ])(
    "%s: a wall time in the gap resolves forward by the gap length, never backward",
    (zone, gapWall, expectedUtc, readsBackAs) => {
      const resolved = wallTimeToUtc(gapWall, zone);
      expect(resolved.toISOString()).toBe(expectedUtc);
      // The resolved instant reads back as a wall time that actually exists,
      // *after* the jump — the pre-fix two-pass result could land before it,
      // reading as an earlier hour (and, in a midnight-gap zone, yesterday).
      expect(utcToWallTime(resolved, zone)).toEqual(readsBackAs);
    },
  );

  it("never resolves a gap time onto the previous calendar day (the Santiago regression)", () => {
    // Before the gap fix, Santiago's nonexistent Sep 6 00:00 resolved to
    // 03:00Z — which reads as Sep *5*, 23:00. Any "today" boundary built on
    // it leaked the previous day's last hour into today.
    const resolved = wallTimeToUtc(wall(2026, 9, 6, 0, 0), "America/Santiago");
    expect(utcToWallTime(resolved, "America/Santiago").day).toBe(6);
  });
});

describe("the fall-back night: wall times that exist twice", () => {
  it.each([
    // The ambiguous reading resolves to exactly one instant, and that instant
    // reads back as the same wall time. (Which of the two instants is chosen
    // is pinned, so a refactor that flips it is caught and reviewed.)
    ["America/New_York", wall(2026, 11, 1, 1, 30), "2026-11-01T05:30:00.000Z"],
    ["Australia/Lord_Howe", wall(2026, 4, 5, 1, 45), "2026-04-04T15:15:00.000Z"],
    ["Atlantic/Azores", wall(2026, 10, 25, 0, 30), "2026-10-25T00:30:00.000Z"],
  ])("%s: an ambiguous wall time roundtrips", (zone, ambiguous, pinnedUtc) => {
    const resolved = wallTimeToUtc(ambiguous, zone);
    expect(resolved.toISOString()).toBe(pinnedUtc);
    expect(utcToWallTime(resolved, zone)).toEqual(ambiguous);
  });
});

describe("shopDayBounds across the clock change", () => {
  it("the spring-forward day is 23 hours, bounded by both local midnights", () => {
    const { from, to } = shopDayBounds(new Date("2026-03-08T17:00:00Z"), "America/New_York");
    expect(from.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(23);
  });

  it("the fall-back day is 25 hours, bounded by both local midnights", () => {
    const { from, to } = shopDayBounds(new Date("2026-11-01T17:00:00Z"), "America/New_York");
    expect(from.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(25);
  });

  it("a zone that springs forward AT midnight starts its day at 01:00 local (Santiago)", () => {
    // Sep 6 2026 has no midnight in Santiago: the day starts at 01:00 local
    // (04:00Z) and runs 23 hours to Sep 7's real midnight.
    const { from, to } = shopDayBounds(new Date("2026-09-06T15:00:00Z"), "America/Santiago");
    expect(from.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(utcToWallTime(from, "America/Santiago")).toEqual(wall(2026, 9, 6, 1, 0));
    expect(to.toISOString()).toBe("2026-09-07T03:00:00.000Z");
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(23);
  });

  it("keeps a 23:30 boat on the day it sails when tomorrow's midnight is in the gap (Santiago)", () => {
    // The mirror case: on Sep 5 the day's *end* is tomorrow's nonexistent
    // midnight. Before the gap fix `to` resolved to 03:00Z (= Sep 5, 23:00
    // local), so a 23:30 departure fell out of its own day and into the next.
    const boat2330 = wallTimeToUtc(wall(2026, 9, 5, 23, 30), "America/Santiago");
    const sep5 = shopDayBounds(new Date("2026-09-05T15:00:00Z"), "America/Santiago");
    const sep6 = shopDayBounds(new Date("2026-09-06T15:00:00Z"), "America/Santiago");
    expect(boat2330.getTime()).toBeGreaterThanOrEqual(sep5.from.getTime());
    expect(boat2330.getTime()).toBeLessThan(sep5.to.getTime());
    expect(boat2330.getTime()).toBeLessThan(sep6.from.getTime());
    // And the two days tile with no gap and no overlap.
    expect(sep5.to.getTime()).toBe(sep6.from.getTime());
  });

  it("a zone that falls back AT midnight gets a 25-hour day starting at the FIRST midnight (Azores)", () => {
    const { from, to } = shopDayBounds(new Date("2026-10-25T12:00:00Z"), "Atlantic/Azores");
    expect(from.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-26T01:00:00.000Z");
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(25);
  });

  it("consecutive shop days always tile exactly across both transition nights", () => {
    for (const [zone, isoDays] of [
      ["America/New_York", ["2026-03-07", "2026-03-08", "2026-03-09"]],
      ["America/New_York", ["2026-10-31", "2026-11-01", "2026-11-02"]],
      ["America/Santiago", ["2026-09-05", "2026-09-06", "2026-09-07"]],
      ["Australia/Lord_Howe", ["2026-10-03", "2026-10-04", "2026-10-05"]],
    ] as const) {
      const bounds = isoDays.map((day) => shopDayBounds(new Date(`${day}T17:00:00Z`), zone));
      for (let i = 1; i < bounds.length; i++) {
        expect(bounds[i - 1].to.getTime()).toBe(bounds[i].from.getTime());
      }
    }
  });
});

describe("departures that cross midnight in one calendar but not the other", () => {
  it("a 23:00 local boat is tomorrow in UTC but stays on today's shop day", () => {
    // New York, Jul 18 23:00 local = Jul 19 03:00Z: UTC has already rolled over.
    const boat = wallTimeToUtc(wall(2026, 7, 18, 23, 0), "America/New_York");
    expect(boat.toISOString()).toBe("2026-07-19T03:00:00.000Z");
    const day = shopDayBounds(new Date("2026-07-18T16:00:00Z"), "America/New_York");
    expect(boat.getTime()).toBeGreaterThanOrEqual(day.from.getTime());
    expect(boat.getTime()).toBeLessThan(day.to.getTime());
    expect(calendarDateInTimezone(boat, "America/New_York")).toBe("2026-07-18");
  });

  it("an 08:00 local boat east of UTC is yesterday in UTC but stays on today's shop day", () => {
    // Tokyo, Jul 18 08:00 local = Jul 17 23:00Z: UTC has not rolled over yet.
    const boat = wallTimeToUtc(wall(2026, 7, 18, 8, 0), "Asia/Tokyo");
    expect(boat.toISOString()).toBe("2026-07-17T23:00:00.000Z");
    const day = shopDayBounds(new Date("2026-07-18T01:00:00Z"), "Asia/Tokyo");
    expect(boat.getTime()).toBeGreaterThanOrEqual(day.from.getTime());
    expect(boat.getTime()).toBeLessThan(day.to.getTime());
    expect(calendarDateInTimezone(boat, "Asia/Tokyo")).toBe("2026-07-18");
  });
});

describe("week and month aggregates spanning the shift", () => {
  it("a 7-day window over spring forward is 167 hours; over fall back, 169", () => {
    const springFrom = wallTimeToUtc(wall(2026, 3, 5, 0, 0), "America/New_York");
    const springTo = wallTimeToUtc(addCalendarDays(wall(2026, 3, 5, 0, 0), 7), "America/New_York");
    expect((springTo.getTime() - springFrom.getTime()) / 3_600_000).toBe(167);

    const fallFrom = wallTimeToUtc(wall(2026, 10, 29, 0, 0), "America/New_York");
    const fallTo = wallTimeToUtc(addCalendarDays(wall(2026, 10, 29, 0, 0), 7), "America/New_York");
    expect((fallTo.getTime() - fallFrom.getTime()) / 3_600_000).toBe(169);
  });

  it("a month window over the shift covers every instant exactly once (November = 721h)", () => {
    // The reports page builds [month start, next month start) exactly this way.
    const from = wallTimeToUtc(wall(2026, 11, 1, 0, 0), "America/New_York");
    const to = wallTimeToUtc(wall(2026, 12, 1, 0, 0), "America/New_York");
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(30 * 24 + 1);
    // And a departure in the repeated 1am hour lands inside it, once.
    const repeatedHourBoat = new Date("2026-11-01T06:30:00Z"); // 01:30 EST, the second 01:30
    expect(repeatedHourBoat.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(repeatedHourBoat.getTime()).toBeLessThan(to.getTime());
  });

  it("a weekly series holds its published hour on both sides of the shift", () => {
    // Every-Saturday 07:30 charter, Mar 7 → Mar 14 2026 (over spring forward)
    // and Oct 31 → Nov 7 (over fall back): the wall-clock hour is the promise.
    for (const [start, days] of [
      [wall(2026, 3, 7, 7, 30), 7],
      [wall(2026, 10, 31, 7, 30), 7],
    ] as const) {
      const first = wallTimeToUtc(start, "America/New_York");
      const next = shiftInstantByCalendarDays(first, days, "America/New_York");
      const read = utcToWallTime(next, "America/New_York");
      expect({ hour: read.hour, minute: read.minute }).toEqual({ hour: 7, minute: 30 });
      // ...which means the UTC delta is NOT a whole week of milliseconds.
      expect(next.getTime() - first.getTime()).not.toBe(7 * 24 * 3_600_000);
    }
  });
});

describe("zones with non-hour offsets", () => {
  it("Kathmandu (+05:45) roundtrips exactly", () => {
    const utc = wallTimeToUtc(wall(2026, 7, 18, 8, 0), "Asia/Kathmandu");
    expect(utc.toISOString()).toBe("2026-07-18T02:15:00.000Z");
    expect(utcToWallTime(utc, "Asia/Kathmandu")).toEqual(wall(2026, 7, 18, 8, 0));
  });

  it("Chatham (+13:45 in DST) roundtrips exactly", () => {
    const utc = wallTimeToUtc(wall(2026, 1, 15, 8, 0), "Pacific/Chatham");
    expect(utc.toISOString()).toBe("2026-01-14T18:15:00.000Z");
    expect(utcToWallTime(utc, "Pacific/Chatham")).toEqual(wall(2026, 1, 15, 8, 0));
  });

  it("Lord Howe's 30-minute DST shift moves a shifted trip's UTC instant by 30 minutes", () => {
    // Weekly 09:00 charter across the Oct 4 2026 half-hour spring forward.
    const before = wallTimeToUtc(wall(2026, 10, 3, 9, 0), "Australia/Lord_Howe");
    const after = shiftInstantByCalendarDays(before, 7, "Australia/Lord_Howe");
    expect(utcToWallTime(after, "Australia/Lord_Howe")).toEqual(wall(2026, 10, 10, 9, 0));
    expect(after.getTime() - before.getTime()).toBe(7 * 24 * 3_600_000 - 30 * 60_000);
  });
});

describe("moving a trip across the shift (the schedule builder's seam)", () => {
  it("a whole-day move never drifts the hour; a time-of-day move lands on the asked-for time", () => {
    // moveTrip composes wallTimeDeltaMs + shiftInstantByWallTimeDelta. A move
    // from Sat Mar 7 09:00 to Sun Mar 8 07:15 crosses spring forward AND
    // changes the time of day: the result must be exactly Mar 8 07:15 local.
    const from = wall(2026, 3, 7, 9, 0);
    const to = wall(2026, 3, 8, 7, 15);
    const delta = wallTimeDeltaMs(from, to);
    const moved = shiftInstantByWallTimeDelta(
      wallTimeToUtc(from, "America/New_York"),
      delta,
      "America/New_York",
    );
    expect(utcToWallTime(moved, "America/New_York")).toEqual(to);
  });

  it("a multi-day course's later days keep their published hour across the shift", () => {
    // Open Water weekend: day 1 Sat Mar 7 08:30, day 2 Sun Mar 8 08:30 — the
    // second morning is after the jump and must still read 08:30 local.
    const dayOne = wall(2026, 3, 7, 8, 30);
    const dayTwo = addCalendarDays(dayOne, 1);
    const utcOne = wallTimeToUtc(dayOne, "America/New_York");
    const utcTwo = wallTimeToUtc(dayTwo, "America/New_York");
    expect(utcToWallTime(utcTwo, "America/New_York")).toEqual(wall(2026, 3, 8, 8, 30));
    expect(utcTwo.getTime() - utcOne.getTime()).toBe(23 * 3_600_000);
  });

  it("a shift that lands ON the nonexistent hour resolves forward, not backward", () => {
    // A 02:30 dawn departure copied from Mar 7 to Mar 8 has nowhere to land:
    // it reads 03:30 EDT, never 01:30 EST (which would be BEFORE the original
    // wall time it was promised at).
    const dawn = wallTimeToUtc(wall(2026, 3, 7, 2, 30), "America/New_York");
    const copied = shiftInstantByCalendarDays(dawn, 1, "America/New_York");
    expect(utcToWallTime(copied, "America/New_York")).toEqual(wall(2026, 3, 8, 3, 30));
  });
});

describe("day-relative words and reminder offsets at the boundaries", () => {
  it("formatRelativeDay reads the shop's calendar, not UTC's", () => {
    // Jul 18 23:00 New York (Jul 19 03:00Z), read the same evening at 18:00
    // local (Jul 18 22:00Z): "today" in the shop's zone even though the boat's
    // UTC date is tomorrow relative to the reader's UTC date.
    const boat = new Date("2026-07-19T03:00:00.000Z");
    const readAt = new Date("2026-07-18T22:00:00.000Z"); // 18:00 Jul 18 local
    expect(formatRelativeDay(boat, readAt, "en-US", "America/New_York")).toBe("today");
    expect(formatRelativeDay(boat, readAt, "en-US", "UTC")).toBe("tomorrow");
  });

  it("formatRelativeDay counts calendar days, not 24-hour blocks, across the shift", () => {
    // Sat Mar 7 09:00 EST → Sat Mar 14 09:00 EDT is 167 elapsed hours; a
    // millisecond division would floor it to 6 days. It is 7 calendar days.
    const now = wallTimeToUtc(wall(2026, 3, 7, 9, 0), "America/New_York");
    const nextWeek = wallTimeToUtc(wall(2026, 3, 14, 9, 0), "America/New_York");
    expect(formatRelativeDay(nextWeek, now, "en-US", "America/New_York")).toBe("in 7 days");
  });

  it("dueReminder's 24h bucket still opens the evening before across spring forward", () => {
    // Boat: Sun Mar 8 09:00 EDT (13:00Z). T-24h = Sat 13:00Z = 08:00 EST —
    // only 23 wall-clock hours before departure. The night-before scan (Sat
    // evening) is inside the bucket either way; pin that the cadence's
    // absolute-time contract holds and nothing fires after departure.
    const startsAt = wallTimeToUtc(wall(2026, 3, 8, 9, 0), "America/New_York");
    const saturdayEvening = wallTimeToUtc(wall(2026, 3, 7, 19, 0), "America/New_York");
    expect(dueReminder({ startsAt, now: saturdayEvening, sentKinds: new Set() })?.kind).toBe(
      "trip_reminder_24h",
    );
    // Just before the bucket opens it is still the 7-day reminder's window...
    const fridayEvening = wallTimeToUtc(wall(2026, 3, 6, 19, 0), "America/New_York");
    expect(dueReminder({ startsAt, now: fridayEvening, sentKinds: new Set() })?.kind).toBe(
      "trip_reminder_7d",
    );
    // ...and once the boat has left, nothing fires at all.
    const afterDeparture = new Date(startsAt.getTime() + 60_000);
    expect(dueReminder({ startsAt, now: afterDeparture, sentKinds: new Set() })).toBeNull();
  });

  it("a date-only expiry in a far-east zone expires on the shop's calendar, not UTC's", () => {
    // A cert that expires 2026-07-18: at 2026-07-18T13:00Z it is already Jul
    // 19 in Auckland (expired) but still Jul 18 in Honolulu (valid).
    const instant = new Date("2026-07-18T13:00:00.000Z");
    expect(calendarDateInTimezone(instant, "Pacific/Auckland")).toBe("2026-07-19");
    expect(calendarDateInTimezone(instant, "Pacific/Honolulu")).toBe("2026-07-18");
  });
});
