import { describe, expect, it } from "vitest";
import { ageOnDate, checkMinimumAge, isPlausibleDateOfBirth, maxPlausibleBirthDate } from "./age";

describe("ageOnDate", () => {
  it("counts whole years once the birthday has passed", () => {
    expect(ageOnDate("2010-03-01", "2026-07-24")).toBe(16);
  });

  it("does not count the year until the birthday arrives", () => {
    expect(ageOnDate("2010-12-01", "2026-07-24")).toBe(15);
  });

  it("counts the birthday itself", () => {
    expect(ageOnDate("2010-07-24", "2026-07-24")).toBe(16);
    // The day before still reads as the younger age.
    expect(ageOnDate("2010-07-25", "2026-07-24")).toBe(15);
  });

  it("handles a leap-day birthday without slipping a year", () => {
    expect(ageOnDate("2012-02-29", "2026-02-28")).toBe(13);
    expect(ageOnDate("2012-02-29", "2026-03-01")).toBe(14);
  });
});

describe("checkMinimumAge", () => {
  it("is unknown with no date of birth on file — the caller fails open (H-08)", () => {
    expect(checkMinimumAge(null, 15, "2026-07-24")).toEqual({ status: "unknown" });
    expect(checkMinimumAge(undefined, 15, "2026-07-24")).toEqual({ status: "unknown" });
  });

  it("is unknown when the course states no minimum age", () => {
    expect(checkMinimumAge("2010-03-01", null, "2026-07-24")).toEqual({ status: "unknown" });
  });

  it("admits a diver at or over the minimum", () => {
    expect(checkMinimumAge("2010-03-01", 15, "2026-07-24")).toEqual({ status: "meets", age: 16 });
    expect(checkMinimumAge("2011-07-24", 15, "2026-07-24")).toEqual({ status: "meets", age: 15 });
  });

  it("refuses a diver under the minimum, reporting both numbers", () => {
    expect(checkMinimumAge("2012-03-01", 15, "2026-07-24")).toEqual({
      status: "under",
      age: 14,
      minimumAge: 15,
    });
  });

  it("measures age on the course date, not the booking date", () => {
    // Books in July at 14, but the session runs after their December birthday.
    expect(checkMinimumAge("2011-12-01", 15, "2026-07-24")).toEqual({
      status: "under",
      age: 14,
      minimumAge: 15,
    });
    expect(checkMinimumAge("2011-12-01", 15, "2026-12-15")).toEqual({ status: "meets", age: 15 });
  });
});

describe("isPlausibleDateOfBirth", () => {
  // Early UTC: before 10:00 UTC, UTC+14 is still on the same calendar day, so
  // the bound here is plainly "today".
  const now = new Date("2026-07-24T02:00:00.000Z");

  it("accepts an ordinary birth date", () => {
    expect(isPlausibleDateOfBirth("1988-02-29", now)).toBe(true);
  });

  it("accepts today", () => {
    expect(isPlausibleDateOfBirth("2026-07-24", now)).toBe(true);
  });

  it("rejects a future date — the year typo that would silently refuse every age-gated course", () => {
    expect(isPlausibleDateOfBirth("2062-03-04", now)).toBe(false);
    expect(isPlausibleDateOfBirth("2026-07-25", now)).toBe(false);
  });

  it("rejects a pre-1900 date", () => {
    expect(isPlausibleDateOfBirth("1899-12-31", now)).toBe(false);
    expect(isPlausibleDateOfBirth("1900-01-01", now)).toBe(true);
  });

  it("gives the furthest-ahead timezone its own today rather than the server's", () => {
    // 12:00 UTC on the 24th is already the 25th in Kiritimati (UTC+14). A shop
    // there recording a birth date on their calendar must not be refused.
    const lateUtc = new Date("2026-07-24T12:00:00.000Z");
    expect(maxPlausibleBirthDate(lateUtc)).toBe("2026-07-25");
    expect(isPlausibleDateOfBirth("2026-07-25", lateUtc)).toBe(true);
  });
});
