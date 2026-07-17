import { describe, expect, it } from "vitest";
import { capacityLabel, isFull, spotsRemaining } from "./trips";

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
  it("pluralizes correctly", () => {
    expect(capacityLabel({ capacity: 12, booked: 9 })).toBe("3 spots left");
    expect(capacityLabel({ capacity: 12, booked: 11 })).toBe("1 spot left");
  });

  it("says Full at capacity", () => {
    expect(capacityLabel({ capacity: 10, booked: 10 })).toBe("Full");
  });
});
