import { describe, expect, it } from "vitest";
import {
  afterHoursPingWanted,
  DEFAULT_DESK_HOURS,
  deskClosedSince,
  deskTimeValue,
  isAfterHours,
  parseDeskHours,
  parseDeskTime,
} from "./desk-hours";

const NY = "America/New_York";

describe("isAfterHours", () => {
  it("reads the desk's window in the shop's own wall clock", () => {
    // 2026-10-09 is EDT (UTC-4): 12:00Z is 08:00 local, the first open minute.
    expect(isAfterHours(new Date("2026-10-09T11:59:00Z"), NY, DEFAULT_DESK_HOURS)).toBe(true);
    expect(isAfterHours(new Date("2026-10-09T12:00:00Z"), NY, DEFAULT_DESK_HOURS)).toBe(false);
    expect(isAfterHours(new Date("2026-10-09T21:59:00Z"), NY, DEFAULT_DESK_HOURS)).toBe(false);
    // 18:00 local is the first closed minute: closes is exclusive.
    expect(isAfterHours(new Date("2026-10-09T22:00:00Z"), NY, DEFAULT_DESK_HOURS)).toBe(true);
  });

  it("follows the zone, not UTC", () => {
    const at = new Date("2026-10-09T14:00:00Z");
    expect(isAfterHours(at, NY, DEFAULT_DESK_HOURS)).toBe(false);
    // 23:00 in Singapore.
    expect(isAfterHours(at, "Asia/Singapore", DEFAULT_DESK_HOURS)).toBe(true);
  });
});

describe("deskClosedSince", () => {
  it("is this evening's closing in the evening", () => {
    expect(deskClosedSince(new Date("2026-10-10T01:30:00Z"), NY, DEFAULT_DESK_HOURS)).toEqual(
      new Date("2026-10-09T22:00:00Z"),
    );
  });

  it("is yesterday's closing in the small hours", () => {
    // 05:00 local on the 10th: the desk closed at 18:00 on the 9th.
    expect(deskClosedSince(new Date("2026-10-10T09:00:00Z"), NY, DEFAULT_DESK_HOURS)).toEqual(
      new Date("2026-10-09T22:00:00Z"),
    );
  });

  it("holds across a clock change", () => {
    // 2026-11-01 01:30 EST, the night New York falls back: closed at 18:00 EDT.
    expect(deskClosedSince(new Date("2026-11-01T06:30:00Z"), NY, DEFAULT_DESK_HOURS)).toEqual(
      new Date("2026-10-31T22:00:00Z"),
    );
  });
});

describe("afterHoursPingWanted", () => {
  it("defaults on for the owner and a manager, off for everyone else", () => {
    expect(afterHoursPingWanted(null, ["owner"])).toBe(true);
    expect(afterHoursPingWanted(null, ["manager"])).toBe(true);
    expect(afterHoursPingWanted(null, ["crew"])).toBe(false);
    expect(afterHoursPingWanted(null, ["instructor", "divemaster"])).toBe(false);
  });

  it("takes the person's own answer over their role's", () => {
    expect(afterHoursPingWanted(false, ["owner"])).toBe(false);
    expect(afterHoursPingWanted(true, ["crew"])).toBe(true);
  });
});

describe("parseDeskHours", () => {
  it("reads a time input's values", () => {
    expect(parseDeskHours("07:30", "17:00")).toEqual({ opensMinute: 450, closesMinute: 1020 });
    expect(parseDeskTime("00:00")).toBe(0);
    expect(parseDeskTime("23:59")).toBe(1439);
  });

  it.each([
    ["17:00", "07:30"],
    ["09:00", "09:00"],
    ["24:00", "25:00"],
    ["9:00", "17:00"],
    ["09:60", "17:00"],
    [null, "17:00"],
    [9, 17],
  ])("refuses %j to %j", (opens, closes) => {
    expect(parseDeskHours(opens, closes)).toBeNull();
  });

  it("writes minutes back as a time input's value", () => {
    expect(deskTimeValue(450)).toBe("07:30");
    expect(deskTimeValue(1080)).toBe("18:00");
  });
});
