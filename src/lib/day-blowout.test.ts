import { describe, expect, it } from "vitest";
import {
  type DayBlowoutDeparture,
  dayBlowoutBlock,
  dayBlowoutPicked,
  isDayBlowoutPick,
  isMorningDeparture,
} from "./day-blowout";

const TZ = "America/New_York";
// 06:00 local on 2026-10-10 (EDT, UTC-4).
const now = new Date("2026-10-10T10:00:00Z");

function departure(id: string, localHour: number, extra: Partial<DayBlowoutDeparture> = {}) {
  return {
    id,
    startsAt: new Date(Date.UTC(2026, 9, 10, localHour + 4, 0)),
    status: "scheduled" as const,
    calledOff: false,
    ...extra,
  };
}

describe("isMorningDeparture", () => {
  it("reads the hour in the shop's own zone", () => {
    // 15:30Z is 11:30 in New York: a morning boat, though not in UTC.
    expect(isMorningDeparture(new Date("2026-10-10T15:30:00Z"), TZ)).toBe(true);
    expect(isMorningDeparture(new Date("2026-10-10T16:00:00Z"), TZ)).toBe(false);
  });
});

describe("dayBlowoutBlock", () => {
  it("lets a scheduled departure still ahead be called", () => {
    expect(dayBlowoutBlock(departure("a", 8), now)).toBeNull();
  });

  it("says why the others cannot", () => {
    expect(dayBlowoutBlock(departure("a", 8, { calledOff: true }), now)).toBe("called");
    expect(dayBlowoutBlock(departure("a", 8, { status: "cancelled" }), now)).toBe("cancelled");
    // Left at 04:00, more than the one-hour buffer before 06:00.
    expect(dayBlowoutBlock(departure("a", 4), now)).toBe("departed");
  });
});

describe("dayBlowoutPicked", () => {
  const day = [
    departure("dawn", 4),
    departure("morning", 8),
    departure("late-morning", 11),
    departure("afternoon", 13),
    departure("night", 19, { calledOff: true }),
  ];

  it("ticks every departure that can still be called for the whole day", () => {
    expect(dayBlowoutPicked(day, "all", { now, timeZone: TZ })).toEqual([
      "morning",
      "late-morning",
      "afternoon",
    ]);
  });

  it("ticks only the mornings that can still be called", () => {
    expect(dayBlowoutPicked(day, "morning", { now, timeZone: TZ })).toEqual([
      "morning",
      "late-morning",
    ]);
  });
});

describe("isDayBlowoutPick", () => {
  it("accepts the two presets and nothing else", () => {
    expect(isDayBlowoutPick("all")).toBe(true);
    expect(isDayBlowoutPick("morning")).toBe(true);
    expect(isDayBlowoutPick("evening")).toBe(false);
    expect(isDayBlowoutPick(undefined)).toBe(false);
  });
});
