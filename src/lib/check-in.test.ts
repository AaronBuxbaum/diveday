import { describe, expect, it } from "vitest";
import {
  counterIsClear,
  counterTally,
  firstVisitMarksAnException,
  isBlockedAtCounter,
  isSettledAtCounter,
} from "./check-in";

const seat = (bookingStatus: string, status: "ready" | "blocked" = "ready") => ({
  bookingStatus,
  readiness: { status },
});

describe("isSettledAtCounter", () => {
  it("is true only for a diver who is through the counter and still cleared", () => {
    expect(isSettledAtCounter(seat("checked_in"))).toBe(true);
    expect(isSettledAtCounter(seat("booked"))).toBe(false);
  });

  /**
   * The safety case this predicate exists for: readiness is re-read on every
   * render and a check-in does not freeze it, so a diver who came through the
   * door an hour ago can be blocked by the time the boat loads. That seat is
   * work, not a receipt.
   */
  it("is false for a checked-in diver readiness has since blocked", () => {
    expect(isSettledAtCounter(seat("checked_in", "blocked"))).toBe(false);
  });
});

describe("isBlockedAtCounter", () => {
  it("counts a blocked seat whether or not it has checked in", () => {
    expect(isBlockedAtCounter(seat("booked", "blocked"))).toBe(true);
    expect(isBlockedAtCounter(seat("checked_in", "blocked"))).toBe(true);
    expect(isBlockedAtCounter(seat("checked_in"))).toBe(false);
  });
});

describe("counterIsClear", () => {
  it("is false for an empty queue — nothing to celebrate having cleared", () => {
    expect(counterIsClear([])).toBe(false);
  });

  it("is false while at least one diver is still to come", () => {
    expect(counterIsClear([seat("checked_in"), seat("booked"), seat("checked_in")])).toBe(false);
  });

  it("is true once every diver is through the counter and cleared", () => {
    expect(counterIsClear([seat("checked_in"), seat("checked_in")])).toBe(true);
    expect(counterIsClear([seat("checked_in")])).toBe(true);
  });

  /**
   * The earned line is the app's signal to stop chasing, so it may not fire
   * over a boat that still has a diver readiness will not clear — the exact
   * shape a `dive-domain-expert` pass caught on the shipped counter, where a
   * checked-in diver who went blocked left the instrument green.
   */
  it("is false when everyone is here but one of them cannot board", () => {
    expect(counterIsClear([seat("checked_in"), seat("checked_in", "blocked")])).toBe(false);
  });
});

describe("firstVisitMarksAnException", () => {
  /**
   * The marker's whole value is that it singles somebody out. A shop's first
   * season makes every diver in the queue a first visit, and the counter
   * printed the line under all nine names at once — a row taller each, on the
   * surface whose promise is a name and one tap, marking nobody.
   */
  it("is false when every visible diver is a first visit", () => {
    expect(firstVisitMarksAnException([{ firstVisit: true }, { firstVisit: true }])).toBe(false);
  });

  it("is true when it separates one diver from another", () => {
    expect(firstVisitMarksAnException([{ firstVisit: true }, { firstVisit: false }])).toBe(true);
  });

  it("is false when nobody is a first visit, and on an empty queue", () => {
    expect(firstVisitMarksAnException([{ firstVisit: false }])).toBe(false);
    expect(firstVisitMarksAnException([])).toBe(false);
  });
});

describe("counterTally", () => {
  /**
   * The property the instrument's composition rests on: the figure, the two
   * remainder phrases and the meter's three bands are one statement about one
   * boat. They were not — `toCome` was `expected - here` and counted the
   * blocked divers a second time, so the words said "3 to come · 2 can't board
   * yet" over a meter drawing 7, 2 and 1, and the whole point of a figure is
   * that nobody has to subtract.
   */
  it("cuts a boat into three groups that sum to everyone expected", () => {
    const tally = counterTally([
      seat("checked_in"),
      seat("checked_in"),
      seat("checked_in", "blocked"),
      seat("booked", "blocked"),
      seat("booked"),
    ]);
    expect(tally).toEqual({ expected: 5, here: 2, cantBoard: 2, toCome: 1 });
    expect(tally.here + tally.cantBoard + tally.toCome).toBe(tally.expected);
  });

  it("counts nobody as here while readiness refuses them, checked in or not", () => {
    expect(counterTally([seat("checked_in", "blocked")])).toEqual({
      expected: 1,
      here: 0,
      cantBoard: 1,
      toCome: 0,
    });
  });

  it("is all zeroes for a departure with nobody on it", () => {
    expect(counterTally([])).toEqual({ expected: 0, here: 0, cantBoard: 0, toCome: 0 });
  });
});
