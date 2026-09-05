import { describe, expect, it } from "vitest";
import {
  capacityLabel,
  DEPARTURE_BUFFER_MS,
  hasReturned,
  hasSailed,
  isFull,
  nextBookableDeparture,
  spotsRemaining,
} from "./trips";

describe("spotsRemaining", () => {
  it("subtracts booked from capacity", () => {
    expect(spotsRemaining({ capacity: 12, booked: 9 })).toBe(3);
  });

  it("never goes negative when overbooked", () => {
    expect(spotsRemaining({ capacity: 10, booked: 11 })).toBe(0);
  });
});

describe("isFull", () => {
  it("is false with spots open", () => {
    expect(isFull({ capacity: 8, booked: 3 })).toBe(false);
  });

  it("is true at capacity and beyond", () => {
    expect(isFull({ capacity: 10, booked: 10 })).toBe(true);
    expect(isFull({ capacity: 10, booked: 12 })).toBe(true);
  });
});

describe("capacityLabel", () => {
  it("returns a code with the remaining count, not a sentence", () => {
    expect(capacityLabel({ capacity: 12, booked: 9 })).toEqual({ kind: "left", remaining: 3 });
    expect(capacityLabel({ capacity: 12, booked: 11 })).toEqual({ kind: "left", remaining: 1 });
  });

  it("returns the full code at capacity", () => {
    expect(capacityLabel({ capacity: 10, booked: 10 })).toEqual({ kind: "full" });
  });
});

describe("nextBookableDeparture", () => {
  const trip = (id: string, booked: number, capacity = 8) => ({ id, booked, capacity });

  it("is the first listed departure when that one already has room", () => {
    // The storefront leads with the next boat as a bookable object, so the
    // card renders even when the week's own first row says the same thing —
    // the row stays too (ADR 20260827-clearwater-surface-language, decision 8).
    const first = trip("a", 3);
    expect(nextBookableDeparture([first, trip("b", 8, 8)])).toBe(first);
  });

  it("skips the full boats to the soonest one with room", () => {
    const buried = trip("c", 2);
    expect(nextBookableDeparture([trip("a", 8, 8), trip("b", 8, 8), buried])).toBe(buried);
  });

  it("is null when everything is full, and on an empty list", () => {
    expect(nextBookableDeparture([trip("a", 8, 8), trip("b", 8, 8)])).toBeNull();
    expect(nextBookableDeparture([])).toBeNull();
  });
});

/**
 * The late-arrival buffer, which was fifteen literals before it was two
 * functions (`scripts/check-departure-buffer.mjs` keeps it that way).
 *
 * These cases are written at the *boundary* on purpose. Every one of the
 * fifteen was correct about the hour; what they disagreed on was the
 * millisecond it lands, and that is the only part a reader cannot check by
 * eye.
 */
describe("the late-arrival buffer", () => {
  const SAILS = new Date("2026-08-27T11:00:00.000Z");
  const RETURNS = new Date("2026-08-27T15:00:00.000Z");
  const plus = (from: Date, ms: number) => new Date(from.getTime() + ms);

  it("is one hour", () => {
    expect(DEPARTURE_BUFFER_MS).toBe(60 * 60 * 1000);
  });

  it("holds a departure at the dock for the whole hour after it was due out", () => {
    expect(hasSailed(SAILS, SAILS)).toBe(false);
    expect(hasSailed(SAILS, plus(SAILS, 59 * 60 * 1000))).toBe(false);
  });

  /**
   * The tie. Seven sites read the departure as gone here and two held it
   * upcoming for one more millisecond — a difference nothing depended on,
   * which is exactly why it survived. Pinned so the next reader inherits a
   * decision rather than a coin flip.
   */
  it("counts the departure as sailed at exactly one hour, not a millisecond later", () => {
    expect(hasSailed(SAILS, plus(SAILS, DEPARTURE_BUFFER_MS))).toBe(true);
    expect(hasSailed(SAILS, plus(SAILS, DEPARTURE_BUFFER_MS - 1))).toBe(false);
  });

  it("asks the same question of the return, against the arrival time", () => {
    expect(hasReturned(RETURNS, plus(RETURNS, DEPARTURE_BUFFER_MS - 1))).toBe(false);
    expect(hasReturned(RETURNS, plus(RETURNS, DEPARTURE_BUFFER_MS))).toBe(true);
  });

  /**
   * The two are a *sequence*, not two spellings of one flag: a boat that has
   * sailed is out, and stays out until an hour past the time it said it would
   * be back. Reading either one as the other is how a staffer watching a boat
   * still on the water gets told there is nothing left to watch.
   */
  it("leaves a departure sailed but not returned for the whole time it is out", () => {
    const underway = plus(SAILS, 2 * 60 * 60 * 1000);
    expect(hasSailed(SAILS, underway)).toBe(true);
    expect(hasReturned(RETURNS, underway)).toBe(false);
  });
});
