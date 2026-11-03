import { describe, expect, it } from "vitest";
import { addBandMode, addBandSeatActions } from "./add-band-mode";

const actions = {
  addBookingAction: () => "regular new",
  addExistingDiverAction: () => "regular pick",
  walkInAddBookingAction: () => "walk-in new",
  walkInAddExistingDiverAction: () => "walk-in pick",
};

/**
 * **Counter mode is the desk's choice, never the clock's** (desk review F1,
 * #2737). Every door that means a booking (the call panel's departure pick,
 * the no-show and sailed rebook links, the board, the Requests ledger, the
 * palette) lands on `?add=1` with no `counter`, and inside the 36-hour
 * arrivals window that must still be a regular booking: before the band, the
 * old `bookings/new/[tripId]` page always made one.
 */
describe("addBandMode", () => {
  it("is a booking inside the arrivals window unless the desk chose the counter", () => {
    expect(addBandMode({ walkInWindow: true, counter: false })).toBe("booking");
    expect(addBandMode({ walkInWindow: true, counter: true })).toBe("counter");
  });

  it("offers no choice outside the window, whatever the URL says", () => {
    expect(addBandMode({ walkInWindow: false, counter: true })).toBeUndefined();
    expect(addBandMode({ walkInWindow: false, counter: false })).toBeUndefined();
  });
});

describe("addBandSeatActions", () => {
  it("binds the regular door for a booking door landing inside the window", () => {
    const bound = addBandSeatActions(addBandMode({ walkInWindow: true, counter: false }), actions);
    expect(bound.addExistingDiverAction()).toBe("regular pick");
    expect(bound.addBookingAction()).toBe("regular new");
  });

  it("binds the walk-in door only at the counter", () => {
    const bound = addBandSeatActions("counter", actions);
    expect(bound.addExistingDiverAction()).toBe("walk-in pick");
    expect(bound.addBookingAction()).toBe("walk-in new");
  });

  it("binds the regular door outside the window", () => {
    const bound = addBandSeatActions(undefined, actions);
    expect(bound.addExistingDiverAction()).toBe("regular pick");
  });
});
