import { describe, expect, it } from "vitest";
import { viewsBoardsEnd } from "./PromotedDateAsk";

describe("where the board says a run keeps going (review 3a, 2026-10-12)", () => {
  const lastTripMonth = { year: 2031, month: 2 };

  it("says it on the last month with a date, and on every month a reader jumps past it", () => {
    for (const viewed of [lastTripMonth, { year: 2031, month: 3 }, { year: 2031, month: 9 }]) {
      expect(viewsBoardsEnd({ viewed, lastTripMonth, explicitMonth: true, morePages: false })).toBe(
        true,
      );
    }
  });

  it("stays quiet before the board's end, and on a board with no dates at all", () => {
    expect(
      viewsBoardsEnd({
        viewed: { year: 2031, month: 1 },
        lastTripMonth,
        explicitMonth: true,
        morePages: false,
      }),
    ).toBe(false);
    expect(
      viewsBoardsEnd({
        viewed: lastTripMonth,
        lastTripMonth: null,
        explicitMonth: true,
        morePages: false,
      }),
    ).toBe(false);
  });

  it("waits, on the default view, until its list has nothing further to page to", () => {
    expect(
      viewsBoardsEnd({
        viewed: lastTripMonth,
        lastTripMonth,
        explicitMonth: false,
        morePages: true,
      }),
    ).toBe(false);
    expect(
      viewsBoardsEnd({
        viewed: lastTripMonth,
        lastTripMonth,
        explicitMonth: false,
        morePages: false,
      }),
    ).toBe(true);
  });
});
