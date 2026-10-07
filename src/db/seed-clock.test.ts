import { describe, expect, it } from "vitest";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { demoTodayDepartureStart } from "./seed-clock";

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
