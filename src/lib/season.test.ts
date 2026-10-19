import { describe, expect, it } from "vitest";
import {
  currentShopSeason,
  parseSeasonStart,
  SEASON_START_DEFAULT,
  seasonStartInstant,
  shopSeasonLabel,
  shopSeasonOf,
} from "./season";

describe("parseSeasonStart", () => {
  it("takes a month and a day a calendar has", () => {
    expect(parseSeasonStart(1, 1)).toEqual({ month: 1, day: 1 });
    expect(parseSeasonStart("5", "1")).toEqual({ month: 5, day: 1 });
    expect(parseSeasonStart(12, 31)).toEqual({ month: 12, day: 31 });
  });

  it.each([
    ["month zero", 0, 1],
    ["month thirteen", 13, 1],
    ["day zero", 1, 0],
    ["29 February", 2, 29],
    ["31 April", 4, 31],
    ["31 June", 6, 31],
    ["31 September", 9, 31],
    ["31 November", 11, 31],
    ["day thirty-two", 1, 32],
  ])("refuses %s", (_case, month, day) => {
    expect(parseSeasonStart(month, day)).toBeNull();
  });

  it.each([
    ["a fraction", 1.5, 1],
    ["not a number", "spring", 1],
    ["nothing at all", null, null],
    ["an empty field", "", ""],
  ])("refuses %s", (_case, month, day) => {
    expect(parseSeasonStart(month, day)).toBeNull();
  });

  it("defaults to the calendar year", () => {
    expect(SEASON_START_DEFAULT).toEqual({ month: 1, day: 1 });
  });
});

describe("seasonStartInstant", () => {
  const NY = "America/New_York";

  it("is this year's anniversary once it has passed", () => {
    const start = seasonStartInstant(new Date("2026-07-21T13:30:00.000Z"), NY, {
      month: 5,
      day: 1,
    });
    // Midnight in New York on 1 May 2026 is 04:00Z, not 00:00Z.
    expect(start.toISOString()).toBe("2026-05-01T04:00:00.000Z");
  });

  it("is last year's before the anniversary comes round", () => {
    const start = seasonStartInstant(new Date("2026-04-30T13:30:00.000Z"), NY, {
      month: 5,
      day: 1,
    });
    expect(start.toISOString()).toBe("2025-05-01T04:00:00.000Z");
  });

  it("counts the anniversary itself as inside the new season", () => {
    // 05:00Z on 1 May is one hour into the shop's own 1 May.
    const start = seasonStartInstant(new Date("2026-05-01T05:00:00.000Z"), NY, {
      month: 5,
      day: 1,
    });
    expect(start.toISOString()).toBe("2026-05-01T04:00:00.000Z");
  });

  it("lands on the shop's midnight in a zone where that is the previous UTC day", () => {
    const start = seasonStartInstant(
      new Date("2026-07-21T13:30:00.000Z"),
      "Pacific/Honolulu",
      SEASON_START_DEFAULT,
    );
    // Honolulu is UTC-10 and takes no summer time: 1 January there is
    // 10:00Z, and a UTC-midnight bound would have started the season ten
    // hours early.
    expect(start.toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  it("lands on the shop's midnight east of UTC", () => {
    const start = seasonStartInstant(
      new Date("2026-07-21T13:30:00.000Z"),
      "Indian/Maldives",
      SEASON_START_DEFAULT,
    );
    expect(start.toISOString()).toBe("2025-12-31T19:00:00.000Z");
  });
});

describe("the shop's year as a season (issue #2657)", () => {
  const NY = "America/New_York";

  it("is the calendar year for a January start, named by its year", () => {
    const season = shopSeasonOf(2026, { month: 1, day: 1 });
    expect(season).toEqual({ year: 2026, startsOn: "2026-01-01", endsOn: "2026-12-31" });
    expect(shopSeasonLabel(season)).toBe("2026");
  });

  it("runs twelve months from any other start, named across both years", () => {
    const season = shopSeasonOf(2026, { month: 5, day: 15 });
    expect(season).toEqual({ year: 2026, startsOn: "2026-05-15", endsOn: "2027-05-14" });
    expect(shopSeasonLabel(season)).toBe("2026–27");
    expect(shopSeasonLabel(shopSeasonOf(2099, { month: 5, day: 1 }))).toBe("2099–00");
  });

  it("ends a March season on the last day of February, leap year or not", () => {
    expect(shopSeasonOf(2027, { month: 3, day: 1 }).endsOn).toBe("2028-02-29");
    expect(shopSeasonOf(2026, { month: 3, day: 1 }).endsOn).toBe("2027-02-28");
  });

  it("finds the season now is in, on the shop's own midnight", () => {
    const may = { month: 5, day: 1 };
    // 23:30 on April 30 in New York is May 1 in UTC: still last season.
    expect(currentShopSeason(new Date("2026-05-01T03:30:00Z"), NY, may).year).toBe(2025);
    expect(currentShopSeason(new Date("2026-05-01T04:00:00Z"), NY, may).year).toBe(2026);
  });
});
