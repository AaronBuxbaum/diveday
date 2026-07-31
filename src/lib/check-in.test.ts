import { describe, expect, it } from "vitest";
import { allDiversCheckedIn } from "./check-in";

describe("allDiversCheckedIn", () => {
  it("is false for an empty queue — nothing to celebrate having cleared", () => {
    expect(allDiversCheckedIn([])).toBe(false);
  });

  it("is false while at least one diver is still pending", () => {
    expect(
      allDiversCheckedIn([
        { bookingStatus: "checked_in" },
        { bookingStatus: "booked" },
        { bookingStatus: "checked_in" },
      ]),
    ).toBe(false);
  });

  it("is true once every diver in the queue has checked in", () => {
    expect(
      allDiversCheckedIn([{ bookingStatus: "checked_in" }, { bookingStatus: "checked_in" }]),
    ).toBe(true);
  });

  it("is true for a single checked-in diver", () => {
    expect(allDiversCheckedIn([{ bookingStatus: "checked_in" }])).toBe(true);
  });
});
