import { describe, expect, it } from "vitest";
import { capacityLabel, isFull, nextBookableDeparture, spotsRemaining } from "./trips";

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
