import { describe, expect, it } from "vitest";
import {
  counterIsClear,
  counterIsDone,
  counterTally,
  firstVisitMarksAnException,
  isBlockedAtCounter,
  isNoShowAtCounter,
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
   * A staffer who marks the last outstanding name "Not here" has said, in as
   * many words, that nobody is left to chase — so the accent lands. Counting
   * the released seat as outstanding would leave the counter arguing with the
   * person who just told it (issue #1209).
   */
  it("is true when the only diver left was marked not here", () => {
    expect(counterIsClear([seat("checked_in"), seat("no_show")])).toBe(true);
  });

  it("is still false when a released seat is the only row at all", () => {
    expect(counterIsClear([seat("no_show")])).toBe(false);
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

  /**
   * **"Everybody is here" is a claim only a human can make.** Since N-24 a seat
   * can settle without a staffer laying eyes on the diver, and proxy check-in
   * is the ordinary use of a self-serve kiosk rather than an abuse of one — one
   * half of a couple parks the car while the other types both surnames. If the
   * accent fired on that, the shop would stop phoning a diver still at their
   * hotel, which is the twenty minutes before the boat leaves.
   */
  it("is false when a settled seat only says it is here", () => {
    expect(
      counterIsClear([seat("checked_in"), { ...seat("checked_in"), selfReported: true }]),
    ).toBe(false);
  });

  it("still counts a self-reported seat as here, and only holds the accent back", () => {
    const seats = [seat("checked_in"), { ...seat("checked_in"), selfReported: true }];
    expect(counterTally(seats)).toEqual({
      expected: 2,
      here: 2,
      cantBoard: 0,
      toCome: 0,
      notHere: 0,
    });
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
    expect(tally).toEqual({ expected: 5, here: 2, cantBoard: 2, toCome: 1, notHere: 0 });
    expect(tally.here + tally.cantBoard + tally.toCome).toBe(tally.expected);
  });

  it("counts nobody as here while readiness refuses them, checked in or not", () => {
    expect(counterTally([seat("checked_in", "blocked")])).toEqual({
      expected: 1,
      here: 0,
      cantBoard: 1,
      toCome: 0,
      notHere: 0,
    });
  });

  it("is all zeroes for a departure with nobody on it", () => {
    expect(counterTally([])).toEqual({
      expected: 0,
      here: 0,
      cantBoard: 0,
      toCome: 0,
      notHere: 0,
    });
  });

  /**
   * **A released seat leaves `expected` and is still said out loud** (issue
   * #1209). Both halves matter: the figure is a claim about who the boat is
   * carrying, so "4 of 7 here" over a diver a staffer has already said is not
   * coming is a figure that can never complete — and a count that silently
   * drops a person is the other way to lie about a boat.
   */
  it("takes a released seat out of everyone expected and reports it separately", () => {
    const tally = counterTally([seat("checked_in"), seat("booked"), seat("no_show")]);
    expect(tally).toEqual({ expected: 2, here: 1, cantBoard: 0, toCome: 1, notHere: 1 });
    expect(tally.here + tally.cantBoard + tally.toCome).toBe(tally.expected);
  });

  /**
   * The double count the three bands would otherwise carry: a released seat
   * whose readiness never cleared is one row, and it must not be both
   * `cantBoard` and `notHere`.
   */
  it("does not also count a released seat as unable to board", () => {
    expect(counterTally([seat("no_show", "blocked")])).toEqual({
      expected: 0,
      here: 0,
      cantBoard: 0,
      toCome: 0,
      notHere: 1,
    });
  });
});

describe("isNoShowAtCounter and counterIsDone", () => {
  it("marks only a released seat, and never a checked-in one", () => {
    expect(isNoShowAtCounter(seat("no_show"))).toBe(true);
    expect(isNoShowAtCounter(seat("checked_in"))).toBe(false);
    expect(isNoShowAtCounter(seat("booked"))).toBe(false);
  });

  /**
   * The split `CounterQueue` draws its working list on. A released seat needs
   * no tap, so it leaves the list of work — but it is not "settled" either,
   * and the two groups are drawn from two predicates for that reason.
   */
  it("is the counter's finished set: settled or released, never merely booked", () => {
    expect(counterIsDone(seat("checked_in"))).toBe(true);
    expect(counterIsDone(seat("no_show"))).toBe(true);
    expect(counterIsDone(seat("booked"))).toBe(false);
    expect(counterIsDone(seat("checked_in", "blocked"))).toBe(false);
  });
});
