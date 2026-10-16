import { describe, expect, it } from "vitest";
import { OFF_SEASON_QUIET_DAYS, offSeason, reopensOnTooFar } from "./off-season";

const now = new Date("2026-01-15T12:00:00Z");
const TZ = "America/New_York";
const inDays = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

describe("offSeason", () => {
  it("is not quiet while a departure sits inside the window", () => {
    expect(offSeason({ now, timeZone: TZ, firstDeparture: inDays(29) })).toEqual({
      quiet: false,
      opensAt: null,
      reopensOn: null,
    });
  });

  it("holds the boundary: a departure exactly at the horizon still counts as in season", () => {
    const edge = inDays(OFF_SEASON_QUIET_DAYS);
    expect(offSeason({ now, timeZone: TZ, firstDeparture: edge }).quiet).toBe(false);
    // One millisecond later is the first quiet board — the comparison is
    // strictly greater-than, so the horizon day itself is never orphaned.
    expect(
      offSeason({ now, timeZone: TZ, firstDeparture: new Date(edge.getTime() + 1) }).quiet,
    ).toBe(true);
  });

  it("names the departure the shop is back on when one sits beyond the window", () => {
    const back = inDays(60);
    expect(offSeason({ now, timeZone: TZ, firstDeparture: back })).toEqual({
      quiet: true,
      opensAt: back,
      reopensOn: null,
    });
  });

  it("says quiet with nothing to point at while the board is empty", () => {
    expect(offSeason({ now, timeZone: TZ, firstDeparture: null })).toEqual({
      quiet: true,
      opensAt: null,
      reopensOn: null,
    });
  });

  describe("the shop's typed back-out date (2026-10-12)", () => {
    it("names it while the board is empty and the date is still ahead", () => {
      expect(
        offSeason({ now, timeZone: TZ, firstDeparture: null, reopensOn: "2026-03-01" }),
      ).toEqual({ quiet: true, opensAt: null, reopensOn: "2026-03-01" });
    });

    it("never outranks a departure the shop scheduled sooner", () => {
      const scheduled = inDays(90);
      for (const reopensOn of ["2026-06-01", "2026-04-15"]) {
        expect(offSeason({ now, timeZone: TZ, firstDeparture: scheduled, reopensOn })).toEqual({
          quiet: true,
          opensAt: scheduled,
          reopensOn: null,
        });
      }
    });

    // Review 3b (2026-10-12): back out on 1 February, with only a May trip
    // scheduled so far. Naming May would tell a stranger the shop is shut for
    // three months it is open.
    it("names the typed date when it comes before the first departure scheduled", () => {
      expect(
        offSeason({ now, timeZone: TZ, firstDeparture: inDays(110), reopensOn: "2026-02-01" }),
      ).toEqual({ quiet: true, opensAt: null, reopensOn: "2026-02-01" });
    });

    it("goes quiet once the date is today or past, read in the shop's own zone", () => {
      expect(
        offSeason({ now, timeZone: TZ, firstDeparture: null, reopensOn: "2026-01-15" }).reopensOn,
      ).toBeNull();
      expect(
        offSeason({ now, timeZone: TZ, firstDeparture: null, reopensOn: "2025-12-01" }).reopensOn,
      ).toBeNull();
      // 02:00Z on the 16th is still the 15th in New York, so the 16th is ahead.
      expect(
        offSeason({
          now: new Date("2026-01-16T02:00:00Z"),
          timeZone: TZ,
          firstDeparture: null,
          reopensOn: "2026-01-16",
        }).reopensOn,
      ).toBe("2026-01-16");
    });

    it("says nothing for a date that is not a date", () => {
      expect(
        offSeason({ now, timeZone: TZ, firstDeparture: null, reopensOn: "2026-02-30" }).reopensOn,
      ).toBeNull();
    });

    it("says nothing beside a board that is not quiet", () => {
      expect(
        offSeason({ now, timeZone: TZ, firstDeparture: inDays(3), reopensOn: "2026-03-01" }),
      ).toEqual({ quiet: false, opensAt: null, reopensOn: null });
    });
  });
});

describe("reopensOnTooFar", () => {
  it("allows a date up to eighteen months out and refuses one day past it", () => {
    expect(reopensOnTooFar("2027-07-15", "2026-01-15")).toBe(false);
    expect(reopensOnTooFar("2027-07-16", "2026-01-15")).toBe(true);
  });

  it("refuses a typo'd year and never refuses a past date", () => {
    expect(reopensOnTooFar("2062-03-01", "2026-01-15")).toBe(true);
    expect(reopensOnTooFar("2025-03-01", "2026-01-15")).toBe(false);
  });
});
