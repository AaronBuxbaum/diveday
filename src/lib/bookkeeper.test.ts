import { describe, expect, it } from "vitest";
import { bookkeeperAddress, bookkeeperMonthDue, bookkeeperMonthOnSet } from "./bookkeeper";

const TZ = "America/New_York";

describe("bookkeeperMonthDue", () => {
  it("is last month from the shop's own 2nd until it is sent", () => {
    const second = new Date("2026-11-02T14:00:00Z");
    expect(bookkeeperMonthDue(second, TZ, "2026-09")).toEqual({ year: 2026, month: 10 });
    expect(bookkeeperMonthDue(second, TZ, null)).toEqual({ year: 2026, month: 10 });
    expect(bookkeeperMonthDue(second, TZ, "2026-10")).toBeNull();
  });

  it("waits out the 1st in the shop's zone, even when UTC is already on the 2nd", () => {
    // 01:00 UTC on Nov 2 is still Nov 1 in New York.
    expect(bookkeeperMonthDue(new Date("2026-11-02T01:00:00Z"), TZ, "2026-09")).toBeNull();
  });

  it("rolls over the year", () => {
    expect(bookkeeperMonthDue(new Date("2027-01-02T15:00:00Z"), TZ, "2026-11")).toEqual({
      year: 2026,
      month: 12,
    });
  });
});

describe("bookkeeperMonthOnSet", () => {
  it("counts the month due today as sent, so the first email is the next 2nd's", () => {
    expect(bookkeeperMonthOnSet(new Date("2026-10-20T15:00:00Z"), TZ)).toBe("2026-09");
    expect(bookkeeperMonthOnSet(new Date("2026-11-01T15:00:00Z"), TZ)).toBe("2026-09");
    const setOnFirst = bookkeeperMonthOnSet(new Date("2026-11-01T15:00:00Z"), TZ);
    expect(bookkeeperMonthDue(new Date("2026-11-02T15:00:00Z"), TZ, setOnFirst)).toEqual({
      year: 2026,
      month: 10,
    });
  });
});

describe("bookkeeperAddress", () => {
  it("normalizes an address and refuses what is not one", () => {
    expect(bookkeeperAddress("  Books@Example.COM ")).toBe("books@example.com");
    expect(bookkeeperAddress("")).toBeNull();
    expect(bookkeeperAddress("books at example")).toBeNull();
    expect(bookkeeperAddress("a@b.c, d@e.f")).toBeNull();
    expect(bookkeeperAddress("Books <books@example.com>")).toBeNull();
  });
});
