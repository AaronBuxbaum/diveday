import { describe, expect, it } from "vitest";
import { addBandMode, addBandSeatActions } from "./add-band-mode";

const actions = {
  addBookingAction: () => "regular new",
  addExistingDiverAction: () => "regular pick",
  walkInAddBookingAction: () => "walk-in new",
  walkInAddExistingDiverAction: () => "walk-in pick",
};

/**
 * **The window makes the band the counter; a date request does not** (desk
 * decision, 2026-11-05). Inside the arrivals window the person is usually at
 * the desk, so there is nothing to choose and a name is enough. A band opened
 * from a date request seats a party that asked ahead, so it books.
 */
describe("addBandMode", () => {
  it("is the counter inside the arrivals window", () => {
    expect(addBandMode({ walkInWindow: true, hasRequest: false })).toBe("counter");
  });

  it("books for a date request, even inside the window", () => {
    expect(addBandMode({ walkInWindow: true, hasRequest: true })).toBeUndefined();
  });

  it("books outside the window", () => {
    expect(addBandMode({ walkInWindow: false, hasRequest: false })).toBeUndefined();
  });
});

describe("addBandSeatActions", () => {
  it("binds the walk-in door only at the counter", () => {
    const bound = addBandSeatActions("counter", actions);
    expect(bound.addExistingDiverAction()).toBe("walk-in pick");
    expect(bound.addBookingAction()).toBe("walk-in new");
  });

  it("binds the regular door when booking", () => {
    const bound = addBandSeatActions(undefined, actions);
    expect(bound.addExistingDiverAction()).toBe("regular pick");
    expect(bound.addBookingAction()).toBe("regular new");
  });
});
