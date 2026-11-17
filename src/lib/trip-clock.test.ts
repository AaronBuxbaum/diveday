import { describe, expect, it } from "vitest";
import {
  CLOCK_PHASES,
  clockPhaseOf,
  phaseStanding,
  phaseWhens,
  readyFrom,
  shownClockPhase,
} from "./trip-clock";
import type { TripStage } from "./trip-stages";

// A zone well off UTC: 09:00 local on Mon Nov 16 2026 is 14:00Z (EST, UTC-5).
const ZONE = "America/New_York";
const startsAt = new Date("2026-11-16T14:00:00.000Z");
const endsAt = new Date("2026-11-16T17:30:00.000Z");

function clockAt(
  now: string,
  {
    stage = null,
    recordedAt = "2026-11-16T15:00:00.000Z",
    cancelled = false,
  }: { stage?: TripStage | null; recordedAt?: string; cancelled?: boolean } = {},
) {
  return clockPhaseOf({
    startsAt,
    endsAt,
    now: new Date(now),
    timeZone: ZONE,
    stage: stage ? { stage, recordedAt: new Date(recordedAt) } : null,
    cancelled,
  });
}

describe("clockPhaseOf", () => {
  it("names the five phases in the order a departure moves through them", () => {
    expect(CLOCK_PHASES).toEqual(["filling", "ready", "checkin", "water", "wrapped"]);
  });

  it("is Filling until shop-local midnight of the day before, Getting ready from it", () => {
    // Sat Nov 14, 23:59 local (04:59Z Sun): still Filling, though it is Sunday in UTC.
    expect(clockAt("2026-11-15T04:59:00.000Z")).toBe("filling");
    // Sun Nov 15, 00:00 local is 05:00Z.
    expect(clockAt("2026-11-15T05:00:00.000Z")).toBe("ready");
    // Sun Nov 15, 23:59 local.
    expect(clockAt("2026-11-16T04:59:00.000Z")).toBe("ready");
  });

  it("is Check-in on the day, On the water from the hour, Wrapped up once back", () => {
    expect(clockAt("2026-11-16T05:00:00.000Z")).toBe("checkin");
    expect(clockAt("2026-11-16T14:00:00.000Z")).toBe("water");
    expect(clockAt("2026-11-16T18:31:00.000Z")).toBe("wrapped");
  });

  it("finds the day before across a daylight-saving change", () => {
    // Clocks go back on Sun Nov 1 2026 in New York; a Mon Nov 2 departure
    // is Getting ready from Sun Nov 1, 00:00 EDT (04:00Z).
    const monday = new Date("2026-11-02T14:00:00.000Z");
    expect(readyFrom(monday, ZONE).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("takes the crew's tap over the clock", () => {
    // Boarding tapped at 08:20 local, before the scheduled hour.
    expect(
      clockAt("2026-11-16T13:30:00.000Z", {
        stage: "boarding",
        recordedAt: "2026-11-16T13:20:00.000Z",
      }),
    ).toBe("water");
    // Home tapped before the scheduled return.
    expect(
      clockAt("2026-11-16T16:00:00.000Z", {
        stage: "home",
        recordedAt: "2026-11-16T15:55:00.000Z",
      }),
    ).toBe("wrapped");
  });

  it("has no phase for a cancelled departure, and its page opens on Wrapped up", () => {
    expect(clockAt("2026-11-16T10:00:00.000Z", { cancelled: true })).toBeNull();
    expect(shownClockPhase(undefined, null)).toBe("wrapped");
  });

  describe("a multi-day course between its meeting days", () => {
    // Two Saturdays, 09:00 to 12:00 local: Nov 7 and Nov 14.
    const days = [
      {
        startsAt: new Date("2026-11-07T14:00:00.000Z"),
        endsAt: new Date("2026-11-07T17:00:00.000Z"),
      },
      {
        startsAt: new Date("2026-11-14T14:00:00.000Z"),
        endsAt: new Date("2026-11-14T17:00:00.000Z"),
      },
    ];
    const course = (now: string) =>
      clockPhaseOf({
        startsAt: days[0].startsAt,
        endsAt: days[1].endsAt,
        now: new Date(now),
        timeZone: ZONE,
        stage: null,
        cancelled: false,
        meetingWindows: days,
      });

    it("is Filling in the week between, Getting ready the day before the next, Check-in on it", () => {
      expect(course("2026-11-10T15:00:00.000Z")).toBe("filling");
      // Fri Nov 13, 00:00 local is 05:00Z.
      expect(course("2026-11-13T05:00:00.000Z")).toBe("ready");
      expect(course("2026-11-14T06:00:00.000Z")).toBe("checkin");
      expect(course("2026-11-14T15:00:00.000Z")).toBe("water");
    });
  });
});

describe("shownClockPhase", () => {
  it("shows the phase asked for, else the current one", () => {
    expect(shownClockPhase("filling", "checkin")).toBe("filling");
    expect(shownClockPhase("nonsense", "checkin")).toBe("checkin");
    expect(shownClockPhase(undefined, "ready")).toBe("ready");
  });
});

describe("phaseStanding", () => {
  it("marks phases before the current one done and after it ahead", () => {
    expect(phaseStanding("filling", "checkin")).toBe("done");
    expect(phaseStanding("checkin", "checkin")).toBe("now");
    expect(phaseStanding("wrapped", "checkin")).toBe("ahead");
    expect(phaseStanding("filling", null)).toBe("ahead");
  });
});

describe("phaseWhens", () => {
  const base = {
    startsAt,
    endsAt,
    timeZone: ZONE,
    stage: null,
    cancelled: false,
    booked: 11,
    capacity: 14,
  };

  it("says seats, done, now and the scheduled times during check-in", () => {
    const whens = phaseWhens({ ...base, now: new Date("2026-11-16T13:10:00.000Z") });
    expect(whens.filling).toEqual({ kind: "seats", booked: 11, capacity: 14 });
    expect(whens.ready).toEqual({ kind: "done" });
    expect(whens.checkin).toEqual({ kind: "now" });
    expect(whens.water).toEqual({ kind: "time", at: startsAt });
    expect(whens.wrapped).toEqual({ kind: "time", at: endsAt });
  });

  it("says how many checked in once Check-in is behind", () => {
    const whens = phaseWhens({ ...base, now: new Date("2026-11-16T15:00:00.000Z"), here: 11 });
    expect(whens.checkin).toEqual({ kind: "here", count: 11 });
    expect(whens.water).toEqual({ kind: "now" });
  });

  it("names the day Getting ready starts while Filling", () => {
    const whens = phaseWhens({ ...base, now: new Date("2026-11-11T15:00:00.000Z") });
    expect(whens.ready).toEqual({ kind: "day", at: new Date("2026-11-15T05:00:00.000Z") });
  });

  it("says nothing past Filling for a cancelled departure", () => {
    const whens = phaseWhens({ ...base, cancelled: true, now: new Date("2026-11-11T15:00:00.000Z") });
    expect(whens.ready).toBeNull();
    expect(whens.wrapped).toBeNull();
  });
});
