import { describe, expect, it } from "vitest";
import {
  calendarDateInTimezone,
  isCalendarDateExpired,
  isValidCalendarDate,
} from "./calendar-date";

describe("isValidCalendarDate", () => {
  it("accepts real calendar dates, including a leap day", () => {
    expect(isValidCalendarDate("2026-07-18")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true); // 2024 is a leap year
    expect(isValidCalendarDate("2026-01-31")).toBe(true);
  });

  it("rejects a date that normalizes instead of a real one (CR-009)", () => {
    expect(isValidCalendarDate("2026-02-31")).toBe(false); // February never has 31 days
    expect(isValidCalendarDate("2026-04-31")).toBe(false); // April has 30
    expect(isValidCalendarDate("2025-02-29")).toBe(false); // 2025 is not a leap year
  });

  it("rejects out-of-range months and days, and malformed shapes", () => {
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
    expect(isValidCalendarDate("2026-00-15")).toBe(false);
    expect(isValidCalendarDate("2026-07-00")).toBe(false);
    expect(isValidCalendarDate("2026-7-18")).toBe(false);
    expect(isValidCalendarDate("07-18-2026")).toBe(false);
    expect(isValidCalendarDate("")).toBe(false);
    expect(isValidCalendarDate("not-a-date")).toBe(false);
  });
});

describe("calendarDateInTimezone + isCalendarDateExpired (CR-009)", () => {
  it("a card is not yet expired through the end of its local day in a negative-offset zone", () => {
    // America/St_Thomas is UTC-4 year-round (no DST). At 2026-07-19T02:00Z it
    // is still 2026-07-18 locally — a card expiring 2026-07-18 must still
    // read as valid, not already expired.
    const instant = new Date("2026-07-19T02:00:00.000Z");
    const today = calendarDateInTimezone(instant, "America/St_Thomas");
    expect(today).toBe("2026-07-18");
    expect(isCalendarDateExpired("2026-07-18", today)).toBe(false);
  });

  it("a card expires at the next local day, not the UTC day, in a negative-offset zone", () => {
    // A day later, still within the same UTC calendar date's early hours.
    const instant = new Date("2026-07-20T02:00:00.000Z");
    const today = calendarDateInTimezone(instant, "America/St_Thomas");
    expect(today).toBe("2026-07-19");
    expect(isCalendarDateExpired("2026-07-18", today)).toBe(true);
  });

  it("holds the same boundary correctly in Pacific/Honolulu (UTC-10)", () => {
    const stillValid = new Date("2026-07-19T09:00:00.000Z"); // 2026-07-18 23:00 HST
    expect(calendarDateInTimezone(stillValid, "Pacific/Honolulu")).toBe("2026-07-18");
    expect(
      isCalendarDateExpired("2026-07-18", calendarDateInTimezone(stillValid, "Pacific/Honolulu")),
    ).toBe(false);

    const nowExpired = new Date("2026-07-19T10:00:00.000Z"); // 2026-07-19 00:00 HST
    expect(calendarDateInTimezone(nowExpired, "Pacific/Honolulu")).toBe("2026-07-19");
    expect(
      isCalendarDateExpired("2026-07-18", calendarDateInTimezone(nowExpired, "Pacific/Honolulu")),
    ).toBe(true);
  });

  it("holds the boundary correctly in a positive-offset zone (Pacific/Auckland, UTC+12/+13)", () => {
    // Auckland is well ahead of UTC, so its local day rolls over *before*
    // the UTC day does — the opposite failure direction from a negative
    // offset, and the one a UTC-anchored `T23:59:59.999Z` bug would miss.
    const stillValid = new Date("2026-07-18T10:00:00.000Z"); // 2026-07-18 22:00 NZST (UTC+12)
    expect(calendarDateInTimezone(stillValid, "Pacific/Auckland")).toBe("2026-07-18");
    expect(
      isCalendarDateExpired("2026-07-18", calendarDateInTimezone(stillValid, "Pacific/Auckland")),
    ).toBe(false);

    const nowExpired = new Date("2026-07-18T12:00:00.000Z"); // 2026-07-19 00:00 NZST
    expect(calendarDateInTimezone(nowExpired, "Pacific/Auckland")).toBe("2026-07-19");
    expect(
      isCalendarDateExpired("2026-07-18", calendarDateInTimezone(nowExpired, "Pacific/Auckland")),
    ).toBe(true);
  });
});
