import { describe, expect, it } from "vitest";
import { LEAD_TIME_MIN_SEATS, leadTimeForWeekday, leadTimeLines, wholePercent } from "./lead-time";

const row = (isoWeekday: number, seats: number) => ({
  isoWeekday,
  seats,
  medianDays: 12,
  lastThreeDaysShare: 0.4,
});

describe("leadTimeLines", () => {
  it("names only weekdays with enough history, busiest first, at most three", () => {
    const lines = leadTimeLines([
      row(1, LEAD_TIME_MIN_SEATS - 1),
      row(2, 30),
      row(5, 40),
      row(6, 120),
      row(7, 60),
    ]);
    expect(lines.map((line) => line.isoWeekday)).toEqual([6, 7, 5]);
  });

  it("says nothing for a shop with no history", () => {
    expect(leadTimeLines([row(6, 3)])).toEqual([]);
  });
});

describe("leadTimeForWeekday", () => {
  it("answers the weekday asked about, and only with enough history", () => {
    expect(leadTimeForWeekday([row(6, 50)], 6)?.seats).toBe(50);
    expect(leadTimeForWeekday([row(6, 5)], 6)).toBeNull();
    expect(leadTimeForWeekday([row(6, 50)], 2)).toBeNull();
  });
});

describe("wholePercent", () => {
  it("rounds a share to a whole percent", () => {
    expect(wholePercent(0.404)).toBe(40);
    expect(wholePercent(0)).toBe(0);
  });
});
