import { describe, expect, it } from "vitest";
import { callOffShown } from "./call-off-shown";

/**
 * **Call off is offered only while the trip can still be called off** (domain
 * review 2, ruling): the cancel and blow-out writers refuse a boat that may
 * have left the dock, so once it has sailed, or the crew said Home, the card
 * would be a dead end.
 */
const startsAt = new Date("2026-11-16T09:00:00.000-05:00");

describe("the Call off card", () => {
  it("shows before the boat sails", () => {
    const now = new Date("2026-11-16T08:00:00.000-05:00");
    expect(callOffShown({ cancelled: false, homeSaid: false, startsAt, now })).toBe(true);
  });

  it("hides once the boat has sailed", () => {
    const now = new Date("2026-11-16T12:00:00.000-05:00");
    expect(callOffShown({ cancelled: false, homeSaid: false, startsAt, now })).toBe(false);
  });

  it("hides once the crew said Home, or on a cancelled trip", () => {
    const now = new Date("2026-11-16T08:00:00.000-05:00");
    expect(callOffShown({ cancelled: false, homeSaid: true, startsAt, now })).toBe(false);
    expect(callOffShown({ cancelled: true, homeSaid: false, startsAt, now })).toBe(false);
  });
});
