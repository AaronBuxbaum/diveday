import { describe, expect, it } from "vitest";
import { isSoldOut, seatFill, weekSeatTally } from "./week-seats";

describe("seatFill", () => {
  it("is the share of the seats that are sold", () => {
    expect(seatFill({ booked: 10, capacity: 12 })).toBeCloseTo(10 / 12);
    expect(seatFill({ booked: 0, capacity: 12 })).toBe(0);
    expect(seatFill({ booked: 12, capacity: 12 })).toBe(1);
  });

  /**
   * The failure this function exists for. `0/0` is `NaN`, CSS drops a `NaN`
   * width silently, and the bar then inherits its container's width — so the
   * one departure with no seats to sell would draw as the one that sold out.
   */
  it("draws nothing for a departure with no seats to sell", () => {
    expect(seatFill({ booked: 0, capacity: 0 })).toBe(0);
    expect(seatFill({ booked: 3, capacity: 0 })).toBe(0);
    expect(seatFill({ booked: 0, capacity: -4 })).toBe(0);
  });

  it("fills and stops for an overbooked boat, which the count beside it still reports", () => {
    expect(seatFill({ booked: 13, capacity: 12 })).toBe(1);
  });

  it("never returns NaN or Infinity, whatever it is handed", () => {
    for (const input of [
      { booked: Number.NaN, capacity: 12 },
      { booked: 10, capacity: Number.NaN },
      { booked: Number.POSITIVE_INFINITY, capacity: 12 },
      { booked: 10, capacity: Number.POSITIVE_INFINITY },
    ]) {
      const fill = seatFill(input);
      expect(Number.isFinite(fill)).toBe(true);
      expect(fill).toBeGreaterThanOrEqual(0);
      expect(fill).toBeLessThanOrEqual(1);
    }
  });
});

describe("isSoldOut", () => {
  it("is every seat sold, and at least one seat to sell", () => {
    expect(isSoldOut({ booked: 12, capacity: 12 })).toBe(true);
    expect(isSoldOut({ booked: 13, capacity: 12 })).toBe(true);
    expect(isSoldOut({ booked: 11, capacity: 12 })).toBe(false);
  });

  it("is not sold out when there was never a seat", () => {
    expect(isSoldOut({ booked: 0, capacity: 0 })).toBe(false);
  });
});

describe("weekSeatTally", () => {
  it("sums the week's seats", () => {
    expect(
      weekSeatTally([
        { booked: 10, capacity: 12 },
        { booked: 12, capacity: 12 },
        { booked: 3, capacity: 8 },
      ]),
    ).toEqual({ taken: 25, total: 32 });
  });

  it("is zero of zero for a week with nothing in it", () => {
    expect(weekSeatTally([])).toEqual({ taken: 0, total: 0 });
  });

  /**
   * The line is a fraction a reader scans, so it has to be one at most. An
   * overbooked boat lifts the denominator with it; its own row is where the
   * real numbers are said.
   */
  it("cannot read more sold than offered when a boat is overbooked", () => {
    const tally = weekSeatTally([
      { booked: 13, capacity: 12 },
      { booked: 2, capacity: 8 },
    ]);
    expect(tally).toEqual({ taken: 15, total: 21 });
    expect(tally.taken).toBeLessThanOrEqual(tally.total);
  });

  it("skips an entry carrying a number that is not one", () => {
    expect(
      weekSeatTally([
        { booked: 10, capacity: 12 },
        { booked: Number.NaN, capacity: 12 },
      ]),
    ).toEqual({ taken: 10, total: 12 });
  });

  /**
   * A sailed boat sold its seats. Dropping it would make the same week read
   * differently every morning — 62 of 84 on Monday and 24 of 36 on Friday —
   * which is a number nobody could act on. The tally has no notion of sailing
   * at all, and this pins that it never grows one.
   */
  it("counts a boat whatever it is doing, because a week is a period", () => {
    const entries = [
      { booked: 8, capacity: 12 },
      { booked: 9, capacity: 12 },
    ];
    expect(weekSeatTally(entries)).toEqual({ taken: 17, total: 24 });
  });
});
