import { describe, expect, it } from "vitest";
import { parseWallTime, wallTimeToUtc } from "./zoned";

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
