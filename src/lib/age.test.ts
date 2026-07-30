import { describe, expect, it } from "vitest";
import {
  ageOnDate,
  birthdayCallout,
  checkMinimumAge,
  daysSinceBirthday,
  daysUntilBirthday,
  isMinorOnDate,
  isPlausibleDateOfBirth,
  maxPlausibleBirthDate,
} from "./age";

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

describe("isMinorOnDate", () => {
  it("treats 18 as majority, not the diving world's 15", () => {
    // A 16-year-old holds a full (non-junior) card at 15, but is still a minor
    // for the guardian-signature question H-21 exists to surface.
    expect(isMinorOnDate("2010-03-01", "2026-07-24")).toBe(true);
    expect(isMinorOnDate("2008-07-24", "2026-07-24")).toBe(false);
  });

  it("stops being true on the eighteenth birthday itself", () => {
    expect(isMinorOnDate("2008-07-25", "2026-07-24")).toBe(true);
    expect(isMinorOnDate("2008-07-24", "2026-07-24")).toBe(false);
  });
});

describe("daysUntilBirthday", () => {
  it("is zero on the day itself", () => {
    expect(daysUntilBirthday("1990-07-24", "2026-07-24")).toBe(0);
  });

  it("counts forward to a birthday later this year", () => {
    expect(daysUntilBirthday("1990-07-27", "2026-07-24")).toBe(3);
  });

  it("rolls into next year once this year's birthday has passed", () => {
    // Jul 23 has gone; the next one is 364 days out (2027 is not a leap year).
    expect(daysUntilBirthday("1990-07-23", "2026-07-24")).toBe(364);
  });

  it("crosses a month and a year boundary", () => {
    expect(daysUntilBirthday("1990-01-01", "2026-12-30")).toBe(2);
  });

  it("observes a leap-day birthday on Mar 1 in a common year", () => {
    expect(daysUntilBirthday("2012-02-29", "2026-02-27")).toBe(2);
    expect(daysUntilBirthday("2012-02-29", "2028-02-27")).toBe(2);
  });
});

describe("daysSinceBirthday", () => {
  it("is zero on the day itself", () => {
    expect(daysSinceBirthday("1990-07-24", "2026-07-24")).toBe(0);
  });

  it("counts back to a birthday earlier this year", () => {
    expect(daysSinceBirthday("1990-07-21", "2026-07-24")).toBe(3);
  });

  it("reaches back into last year before this year's birthday arrives", () => {
    expect(daysSinceBirthday("1990-12-30", "2026-01-02")).toBe(3);
  });
});

describe("birthdayCallout", () => {
  it("says nothing without a date of birth", () => {
    expect(birthdayCallout(null, "2026-07-24")).toBeNull();
    expect(birthdayCallout(undefined, "2026-07-24")).toBeNull();
  });

  it("celebrates the day itself", () => {
    expect(birthdayCallout("2012-07-24", "2026-07-24")).toEqual({ status: "today" });
  });

  it("looks ahead across the seven-day window", () => {
    expect(birthdayCallout("2012-07-27", "2026-07-24")).toEqual({ status: "soon", inDays: 3 });
    expect(birthdayCallout("2012-07-31", "2026-07-24")).toEqual({ status: "soon", inDays: 7 });
  });

  it("looks back just as far — a Tuesday birthday still counts on Saturday's boat", () => {
    expect(birthdayCallout("2012-07-22", "2026-07-24")).toEqual({ status: "recent", daysAgo: 2 });
    expect(birthdayCallout("2012-07-17", "2026-07-24")).toEqual({ status: "recent", daysAgo: 7 });
  });

  it("stays quiet past the window in both directions", () => {
    expect(birthdayCallout("2012-08-01", "2026-07-24")).toBeNull();
    expect(birthdayCallout("2012-07-16", "2026-07-24")).toBeNull();
  });

  it("works across a year boundary in both directions", () => {
    expect(birthdayCallout("2012-01-02", "2025-12-30")).toEqual({ status: "soon", inDays: 3 });
    expect(birthdayCallout("2012-12-30", "2026-01-02")).toEqual({ status: "recent", daysAgo: 3 });
  });

  it("honours a caller-supplied window", () => {
    expect(birthdayCallout("2012-07-27", "2026-07-24", 2)).toBeNull();
    expect(birthdayCallout("2012-07-22", "2026-07-24", 1)).toBeNull();
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
