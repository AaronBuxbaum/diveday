import { describe, expect, it } from "vitest";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import {
  demoAtSeaDeparture,
  demoFinishedDuskDeparture,
  demoSunset,
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

  it("sails tomorrow morning, after the 7:00 boat is back, once the day boats are done", () => {
    // Market sheet 2026-10-22, item 1: seeded at 6:34 PM EDT this clamped to
    // 11:30 PM, and the public page led with an "11:30 PM – 3:00 AM" night dive.
    for (const now of [
      new Date("2026-07-20T22:34:00Z"), // 6:34 PM EDT
      new Date("2026-07-21T03:45:00Z"), // 11:45 PM EDT
      new Date("2026-07-21T03:59:30Z"), // 11:59:30 PM EDT
    ]) {
      const start = demoTodayDepartureStart(now, TZ);
      expect(start.toISOString()).toBe("2026-07-21T15:30:00.000Z"); // 11:30 AM EDT tomorrow
    }
  });

  it("keeps a boat that can still leave by 8 PM on today's board", () => {
    const now = new Date("2026-07-20T19:00:00Z"); // 3:00 PM EDT → 8:00 PM
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.toISOString()).toBe("2026-07-21T00:00:00.000Z");
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
    const now = new Date("2026-07-20T19:00:00Z"); // 3:00 PM EDT → the 8:00 PM boat
    const shift = demoTodayShift(now, TZ);
    expect(localDay(shift.startsAt)).toBe(localDay(now));
    expect(localDay(new Date(shift.endsAt.getTime() - 1))).toBe(localDay(now));
    expect(wall(shift.endsAt)).toBe("00:00");
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
    expect(spans(demoTodayShifts(now, TZ, { crew: false }))).toEqual(["08:00-13:30"]);
  });

  it("starts the dawn crew at 4:30, an hour before the 5:30 boat, through the morning boat", () => {
    const now = new Date("2026-07-20T04:30:00Z"); // → the 9:00 AM boat, whose shift starts at 8:00
    expect(spans(demoTodayShifts(now, TZ, { crew: true }))).toEqual(["04:30-13:30"]);
  });

  it("gives everyone else the desk's day when the readiness boat sails tomorrow", () => {
    // UX review 2026-10-13, item 40: the owner and both instructors held a
    // "10:30 PM – 12:00 AM" shift beside the crew of a late boat.
    const now = new Date("2026-10-12T22:30:00Z"); // 6:30 PM EDT → tomorrow's 11:30 AM boat
    expect(spans(demoTodayShifts(now, TZ, { crew: false }))).toEqual(["09:00-17:00"]);
    // The crew's dawn shift today, and tomorrow's around the readiness boat.
    expect(spans(demoTodayShifts(now, TZ, { crew: true }))).toEqual(["04:30-09:30", "10:30-16:00"]);
  });

  it("puts the boat at sea's crew on from an hour before she sailed until an hour after she is due", () => {
    // 9:30 AM EDT: she sailed at 6:30 and is due back at 10:00.
    const now = new Date("2026-07-21T13:30:00Z");
    expect(spans(demoTodayShifts(now, TZ, { crew: false, atSea: true }))).toEqual([
      "05:30-11:00",
      "13:30-19:00",
    ]);
    // 9:30 PM EDT on 22 October: the dusk boat has finished; its crew are not
    // still on shift after the desk's day.
    const evening = new Date("2026-10-23T01:30:00Z");
    expect(spans(demoTodayShifts(evening, TZ, { crew: false, atSea: true }))).toEqual([
      "09:00-17:00",
    ]);
  });

  it("gives the dawn crew a 4:30 to 9:30 shift of its own when today's boat sails in the evening", () => {
    const now = new Date("2026-10-10T17:18:00Z"); // 1:18 PM EDT → a 6:30 PM boat
    expect(spans(demoTodayShifts(now, TZ, { crew: true }))).toEqual(["04:30-09:30", "17:30-23:00"]);
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

  it("calls an 11:30 PM departure a night boat and a 6:30 PM one not", () => {
    expect(sailsAfterDayBoats(new Date("2026-10-13T03:30:00Z"), TZ)).toBe(true); // 11:30 PM EDT
    expect(sailsAfterDayBoats(new Date("2026-10-12T22:30:00Z"), TZ)).toBe(false); // 6:30 PM EDT
  });

  it("never applies to the readiness departure, at any hour the demo is seeded", () => {
    for (let quarter = 0; quarter < 96; quarter++) {
      const now = new Date(Date.UTC(2026, 6, 20, 4) + quarter * 15 * 60_000);
      expect(sailsAfterDayBoats(demoTodayDepartureStart(now, TZ), TZ)).toBe(false);
    }
  });
});

/**
 * **The boat at sea, halfway through her roll call** (market sheet
 * 2026-10-22, item 1): every moment of her record sits in the past of the
 * instant the demo is seeded, in the order a crew would make it, and she
 * sails at an hour a shop sails.
 */
describe("demoAtSeaDeparture", () => {
  const TZ = "America/New_York";
  const wall = (date: Date) => {
    const w = utcToWallTime(date, TZ);
    return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
  };
  const minutes = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;

  it("has her out since 6:30 at the frozen 9:30 AM clock, dive 2 in the water", () => {
    const now = new Date("2026-07-21T13:30:00Z");
    const boat = demoAtSeaDeparture(now, TZ);
    expect(boat && wall(boat.startsAt)).toBe("06:30");
    expect(boat && wall(boat.endsAt)).toBe("10:00");
    expect(boat?.afterDark).toBe(false);
  });

  it("keeps the dusk boat off the at-sea reading after the booth closes", () => {
    expect(demoAtSeaDeparture(new Date("2026-10-23T01:30:00Z"), TZ)).toBeNull();
  });

  it("keeps today's finished dusk roll call after it has closed", () => {
    const now = new Date("2026-10-23T03:44:00Z"); // 11:44 PM EDT
    const boat = demoFinishedDuskDeparture(now, TZ);
    expect(boat && wall(boat.startsAt)).toBe("18:30");
    expect(boat?.startsAt.toISOString()).toBe("2026-10-22T22:30:00.000Z");
    expect(boat?.endsAt.toISOString()).toBe("2026-10-23T02:00:00.000Z");
    expect(boat?.finishedAt.toISOString()).toBe("2026-10-23T01:55:00.000Z");
    expect(boat?.finishedAt.getTime()).toBeLessThan(now.getTime());
    expect(boat?.afterDark).toBe(true);
  });

  it("carries yesterday's finished dusk roll call before the dawn boat", () => {
    const now = new Date("2026-10-23T09:00:00Z"); // 5:00 AM EDT
    const boat = demoFinishedDuskDeparture(now, TZ);
    expect(boat?.startsAt.toISOString()).toBe("2026-10-22T22:30:00.000Z");
    expect(boat?.endsAt.toISOString()).toBe("2026-10-23T02:00:00.000Z");
    expect(boat?.finishedAt.toISOString()).toBe("2026-10-23T01:55:00.000Z");
    expect(boat?.finishedAt.getTime()).toBeLessThan(now.getTime());
    expect(boat?.afterDark).toBe(true);
  });

  it("uses the previous dusk boat when today's dusk trip has not closed yet", () => {
    const now = new Date("2026-10-22T23:15:00Z"); // 7:15 PM EDT
    const boat = demoFinishedDuskDeparture(now, TZ);
    expect(boat?.startsAt.toISOString()).toBe("2026-10-21T22:30:00.000Z");
    expect(boat?.finishedAt.getTime()).toBeLessThan(now.getTime());
  });

  it("does not show a finished roll call during booth hours", () => {
    expect(demoFinishedDuskDeparture(new Date("2026-10-22T15:00:00Z"), TZ)).toBeNull();
  });

  /**
   * **A day boat's second tank is never an unplanned night dive** (dive-domain
   * review of the demo reseed, item 2). Sunset in Key Largo on 22 October is
   * about 6:50 PM EDT; at 7:50 PM a 5:00 PM day boat's dive 2 went in at 7:00,
   * after sunset, so the demo has no boat at sea rather than that one.
   */
  it("puts no day boat in the water after sunset: nobody at sea at 7:50 PM on 22 October", () => {
    expect(wall(demoSunset(new Date("2026-10-22T16:00:00Z"), TZ))).toBe("18:49");
    const boat = demoAtSeaDeparture(new Date("2026-10-22T23:50:00Z"), TZ);
    expect(boat === null || boat.afterDark).toBe(true);
  });

  it("keeps a finished dusk roll call on that day's sunset, in every season", () => {
    for (let month = 0; month < 12; month++) {
      for (const dayOfMonth of [1, 15]) {
        const now = new Date(Date.UTC(2026, month, dayOfMonth, 23));
        const boat = demoFinishedDuskDeparture(now, TZ);
        expect(boat?.afterDark, now.toISOString()).toBe(true);
        if (!boat) throw new Error("expected a finished dusk departure");
        const sunset = demoSunset(boat.startsAt, TZ);
        const label = `${now.toISOString()} sunset ${wall(sunset)}`;
        expect(Math.abs(minutes(sunset, boat.diveOne.enteredAt)), label).toBeLessThanOrEqual(20);
        expect(boat.finishedAt.getTime()).toBeLessThan(now.getTime());
      }
    }
  });

  it("sets sunset by the season: early in December, late in June", () => {
    expect(wall(demoSunset(new Date("2026-12-21T16:00:00Z"), TZ))).toBe("17:36");
    expect(wall(demoSunset(new Date("2026-06-21T16:00:00Z"), TZ))).toBe("20:14");
  });

  it("keeps every moment of the record behind the clock and in a crew's order", () => {
    for (let quarter = 0; quarter < 96; quarter++) {
      const now = new Date(Date.UTC(2026, 9, 22, 4) + quarter * 5 * 60_000 * 3);
      const boat = demoAtSeaDeparture(now, TZ);
      if (!boat) continue;
      const moments = [
        boat.startsAt,
        boat.diveOne.enteredAt,
        boat.diveOne.exitedAt,
        boat.diveOne.countedAt,
        boat.diveTwoEnteredAt,
      ];
      expect([...moments].sort((a, b) => a.getTime() - b.getTime())).toEqual(moments);
      expect(boat.diveTwoEnteredAt.getTime()).toBeLessThan(now.getTime());
      // A surface interval a crew would run, and a boat not yet due home.
      const surface = minutes(boat.diveOne.countedAt, boat.diveTwoEnteredAt);
      expect(surface).toBeGreaterThanOrEqual(40);
      expect(surface).toBeLessThan(70);
      expect(minutes(now, boat.endsAt)).toBeGreaterThanOrEqual(15);
      const sails = utcToWallTime(boat.startsAt, TZ);
      expect(sails.hour * 60 + sails.minute).toBeGreaterThanOrEqual(6 * 60 + 30);
      expect(sails.minute % 30).toBe(0);
    }
  });

  it("keeps the day boat in booth hours and no boat underway after closing", () => {
    const at = (hour: number, minute: number) =>
      demoAtSeaDeparture(new Date(Date.UTC(2026, 9, 22, hour + 4, minute)), TZ);
    expect(at(9, 15)?.afterDark).toBe(false);
    expect(at(13, 0)?.afterDark).toBe(false);
    expect(at(17, 30)?.afterDark).toBe(false);
    expect(at(18, 0)).toBeNull();
    expect(at(19, 50)).toBeNull();
    expect(at(21, 30)).toBeNull();
    expect(at(23, 30)).toBeNull();
    expect(at(2, 0)).toBeNull();
    expect(at(8, 0)).toBeNull();
  });
});
