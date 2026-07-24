import { describe, expect, it } from "vitest";
import { ageOnDate, checkMinimumAge } from "./age";

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
