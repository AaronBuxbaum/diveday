import { describe, expect, it } from "vitest";
import {
  type DayBlowoutDeparture,
  dayBlowoutBlock,
  dayBlowoutBounds,
  dayBlowoutCallable,
  dayBlowoutPicked,
  departureUnderway,
  isDayBlowoutPick,
  isMorningDeparture,
} from "./day-blowout";

const TZ = "America/New_York";
// 06:00 local on 2026-10-10 (EDT, UTC-4).
const now = new Date("2026-10-10T10:00:00Z");

function departure(
  id: string,
  localHour: number,
  extra: Partial<DayBlowoutDeparture> = {},
): DayBlowoutDeparture {
  return {
    id,
    startsAt: new Date(Date.UTC(2026, 9, 10, localHour + 4, 0)),
    status: "scheduled" as const,
    calledOff: false,
    rollCallStarted: false,
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

describe("departureUnderway", () => {
  const startsAt = new Date("2026-10-10T12:00:00Z");

  it("is underway from its start time, with no grace for a late boat", () => {
    expect(
      departureUnderway({ startsAt, rollCallStarted: false }, new Date(startsAt.getTime() - 1)),
    ).toBe(false);
    expect(departureUnderway({ startsAt, rollCallStarted: false }, startsAt)).toBe(true);
    // Twenty minutes after the start: still inside the late-arrival hour, and
    // already too late to call off.
    expect(
      departureUnderway(
        { startsAt, rollCallStarted: false },
        new Date(startsAt.getTime() + 20 * 60_000),
      ),
    ).toBe(true);
  });

  it("is underway the moment anybody is recorded boarding, whatever the clock says", () => {
    expect(
      departureUnderway(
        { startsAt, rollCallStarted: true },
        new Date(startsAt.getTime() - 3_600_000),
      ),
    ).toBe(true);
  });
});

describe("dayBlowoutBlock", () => {
  it("lets a scheduled departure still ahead be called", () => {
    expect(dayBlowoutBlock(departure("a", 8), now)).toBeNull();
  });

  it("says why the others cannot", () => {
    expect(dayBlowoutBlock(departure("a", 8, { calledOff: true }), now)).toBe("called");
    expect(dayBlowoutBlock(departure("a", 8, { status: "cancelled" }), now)).toBe("cancelled");
    // Started at 05:40, twenty minutes before 06:00: on the water, or about to be.
    expect(
      dayBlowoutBlock({ ...departure("a", 5), startsAt: new Date("2026-10-10T09:40:00Z") }, now),
    ).toBe("underway");
    // Boarding has begun on a boat not due out until 08:00.
    expect(dayBlowoutBlock(departure("a", 8, { rollCallStarted: true }), now)).toBe("underway");
  });
});

describe("dayBlowoutPicked", () => {
  const day = [
    departure("dawn", 4),
    departure("morning", 8),
    departure("boarding", 9, { rollCallStarted: true }),
    departure("late-morning", 11),
    departure("afternoon", 13),
    departure("night", 19, { calledOff: true }),
  ];

  it("ticks nothing until a preset is chosen", () => {
    expect(dayBlowoutPicked(day, null, { now, timeZone: TZ })).toEqual([]);
  });

  it("ticks every departure that can still be called for the whole day", () => {
    expect(dayBlowoutPicked(day, "all", { now, timeZone: TZ })).toEqual([
      "morning",
      "late-morning",
      "afternoon",
    ]);
  });

  it("ticks only the departures before noon that can still be called", () => {
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

describe("dayBlowoutBounds", () => {
  it("is the shop's own calendar day, midnight to midnight in its zone", () => {
    expect(dayBlowoutBounds("2026-10-10", TZ)).toEqual({
      from: new Date("2026-10-10T04:00:00Z"),
      to: new Date("2026-10-11T04:00:00Z"),
    });
  });
});

describe("dayBlowoutCallable", () => {
  const day = [
    departure("morning", 8),
    departure("boarding", 9, { rollCallStarted: true }),
    departure("called", 10, { calledOff: true }),
    departure("afternoon", 13),
  ];

  it("calls only this day's departures that can still be called, and counts the rest as skipped", () => {
    expect(
      dayBlowoutCallable(day, ["afternoon", "boarding", "called", "another-day", "morning"], now),
    ).toEqual({ callable: ["morning", "afternoon"], skipped: 3 });
  });

  it("counts a repeated id once", () => {
    expect(dayBlowoutCallable(day, ["morning", "morning"], now)).toEqual({
      callable: ["morning"],
      skipped: 0,
    });
  });
});
