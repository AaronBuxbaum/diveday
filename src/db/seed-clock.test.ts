import { describe, expect, it } from "vitest";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import {
  demoTodayDepartureStart,
  demoTodayShift,
  demoTodayShifts,
  sailsAfterDayBoats,
} from "./seed-clock";

describe("demoTodayDepartureStart", () => {
  const TZ = "America/New_York";
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, TZ));

  it("sails five hours out, rounded to a half-hour slot, in the middle of the day", () => {
    const now = new Date("2026-07-20T15:04:00Z"); // 11:04 AM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.toISOString()).toBe("2026-07-20T20:30:00.000Z"); // 4:30 PM EDT
    expect(localDay(start)).toBe(localDay(now));
  });

  it("never sails before the dawn boat is back, so one crew is never on two boats", () => {
    // Seeded at 12:30 AM EDT, now+5h is 5:30 AM: the dawn two-tank's own slot,
    // crewed by the same captain and divemaster (UX audit 2026-10-07, item 4).
    const now = new Date("2026-07-20T04:30:00Z"); // 12:30 AM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.toISOString()).toBe("2026-07-20T13:00:00.000Z"); // 9:00 AM EDT
    expect(localDay(start)).toBe(localDay(now));
  });

  it("still sails today when now+5h would round past local midnight", () => {
    // Regression: seeding at 6:34 PM EDT put the "sails today" trip at
    // midnight — tomorrow in shop time — emptying the departure board that
    // the Today queue tests and the demo lead with.
    const now = new Date("2026-07-20T22:34:00Z"); // 6:34 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(localDay(start)).toBe(localDay(now));
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(start.toISOString()).toBe("2026-07-21T03:30:00.000Z"); // 11:30 PM EDT
  });

  it("still sails today even when no future half-hour slot is left before midnight", () => {
    // "Today always has a board" has no exception: with less than thirty
    // minutes of the local day left, a half-hour-rounded slot no longer fits,
    // so this falls back to the earliest still-future moment instead of
    // rolling the trip into tomorrow.
    const now = new Date("2026-07-21T03:45:00Z"); // 11:45 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(localDay(start)).toBe(localDay(now));
    expect(start.toISOString()).toBe("2026-07-21T03:46:00.000Z"); // 11:46 PM EDT
  });

  it("never lets the same-day fallback cross into tomorrow", () => {
    // The last minute before local midnight: even "now + 1 minute" would
    // roll into tomorrow, so this clamps to just before midnight instead.
    const now = new Date("2026-07-21T03:59:30Z"); // 11:59:30 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(localDay(start)).toBe(localDay(now));
  });
});

/**
 * **A shift sits on the boat's own local day** (UX review 2026-10-10, item 4).
 * Every demo shift read "5:30 PM – 5:30 AM": a fixed twelve hours from an hour
 * before the departure, straight across the shop's midnight.
 */
describe("demoTodayShift", () => {
  const TZ = "America/New_York";
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, TZ));
  const wall = (date: Date) => {
    const w = utcToWallTime(date, TZ);
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  };

  it("covers the evening boat from an hour before she sails to an hour after she is back", () => {
    const now = new Date("2026-10-10T17:18:00Z"); // 1:18 PM EDT → a 6:30 PM boat
    const shift = demoTodayShift(now, TZ);
    expect(wall(shift.startsAt)).toBe("17:30");
    expect(wall(shift.endsAt)).toBe("23:00");
    expect(localDay(shift.endsAt)).toBe(localDay(shift.startsAt));
  });

  it("starts the morning crew at eight for a nine o'clock boat", () => {
    const now = new Date("2026-07-20T04:30:00Z"); // 12:30 AM EDT → the 9:00 AM boat
    const shift = demoTodayShift(now, TZ);
    expect(wall(shift.startsAt)).toBe("08:00");
    expect(wall(shift.endsAt)).toBe("13:30");
  });

  it("never runs a shift past the shop's midnight", () => {
    const now = new Date("2026-07-20T22:34:00Z"); // 6:34 PM EDT → the 11:30 PM boat
    const shift = demoTodayShift(now, TZ);
    expect(localDay(shift.startsAt)).toBe(localDay(now));
    expect(localDay(new Date(shift.endsAt.getTime() - 1))).toBe(localDay(now));
    expect(shift.endsAt.getTime()).toBeGreaterThan(shift.startsAt.getTime());
  });
});

/**
 * **The dawn boat's crew are on shift for the dawn boat** (dive-domain review
 * of the demo layer). The captain, the divemaster and the assistant crew the
 * 5:30 AM first-light boat, but every shift started an hour before *today's*
 * departure, which never sails before 9:00; the staffing week flagged the
 * demo's own crew as working a boat off shift.
 */
describe("demoTodayShifts", () => {
  const TZ = "America/New_York";
  const wall = (date: Date) => {
    const w = utcToWallTime(date, TZ);
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  };
  const spans = (shifts: { startsAt: Date; endsAt: Date }[]) =>
    shifts.map((shift) => `${wall(shift.startsAt)}-${wall(shift.endsAt)}`);

  it("gives everyone off the dawn boat the one shift around today's departure", () => {
    const now = new Date("2026-07-20T04:30:00Z"); // 12:30 AM EDT → the 9:00 AM boat
    expect(spans(demoTodayShifts(now, TZ, { dawnCrew: false }))).toEqual(["08:00-13:30"]);
  });

  it("starts the dawn crew at 4:30, an hour before the 5:30 boat, through the morning boat", () => {
    const now = new Date("2026-07-20T04:30:00Z"); // → the 9:00 AM boat, whose shift starts at 8:00
    expect(spans(demoTodayShifts(now, TZ, { dawnCrew: true }))).toEqual(["04:30-13:30"]);
  });

  it("gives the dawn crew a 4:30 to 9:30 shift of its own when today's boat sails in the evening", () => {
    const now = new Date("2026-10-10T17:18:00Z"); // 1:18 PM EDT → a 6:30 PM boat
    expect(spans(demoTodayShifts(now, TZ, { dawnCrew: true }))).toEqual([
      "04:30-09:30",
      "17:30-23:00",
    ]);
  });
});

/**
 * **A boat leaving after 8 PM is a night dive** (issue #2440). Seeded in the
 * shop's evening, today's departure can only sail late, and it read as a
 * two-tank reef trip leaving at 11:30 PM.
 */
describe("sailsAfterDayBoats", () => {
  const TZ = "America/New_York";

  it("is false through 8 PM shop time and true after it", () => {
    expect(sailsAfterDayBoats(new Date("2026-07-20T13:00:00Z"), TZ)).toBe(false); // 9:00 AM EDT
    expect(sailsAfterDayBoats(new Date("2026-07-21T00:00:00Z"), TZ)).toBe(false); // 8:00 PM EDT
    expect(sailsAfterDayBoats(new Date("2026-07-21T00:30:00Z"), TZ)).toBe(true); // 8:30 PM EDT
  });

  it("names the evening seed's 11:30 PM slot as the night boat it is", () => {
    const start = demoTodayDepartureStart(new Date("2026-07-20T22:34:00Z"), TZ); // 6:34 PM EDT
    expect(sailsAfterDayBoats(start, TZ)).toBe(true);
    const morning = demoTodayDepartureStart(new Date("2026-07-20T15:04:00Z"), TZ); // 11:04 AM EDT
    expect(sailsAfterDayBoats(morning, TZ)).toBe(false);
  });
});
