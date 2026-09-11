import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "./clock";
import { type NoShowGateInput, noShowGate, salvageOffer, seatIsHeld } from "./no-show";
import type { SimilarDeparture } from "./similar-departures";

const DEPARTURE = new Date("2026-09-11T14:00:00.000Z");

function gate(overrides: Partial<NoShowGateInput> = {}) {
  return noShowGate({
    bookingStatus: "booked",
    boarded: false,
    tripStatus: "scheduled",
    startsAt: DEPARTURE,
    dockCallMinutes: 30,
    now: new Date(DEPARTURE.getTime() - 10 * MINUTE_MS),
    ...overrides,
  });
}

describe("noShowGate", () => {
  it("opens at the shop's own dock call and not a minute before", () => {
    expect(gate({ now: new Date(DEPARTURE.getTime() - 31 * MINUTE_MS) })).toBe("before_dock_call");
    expect(gate({ now: new Date(DEPARTURE.getTime() - 30 * MINUTE_MS) })).toBe("eligible");
    expect(gate({ now: DEPARTURE })).toBe("eligible");
  });

  /**
   * A shop that asks divers to be there two hours early gets two hours of
   * door, and one that asks for ten minutes gets ten. The window is the shop's
   * statement about its own day, not a constant in here.
   */
  it("moves the opening with the shop's dock call", () => {
    const ninetyMinutesOut = new Date(DEPARTURE.getTime() - 90 * MINUTE_MS);
    expect(gate({ dockCallMinutes: 30, now: ninetyMinutesOut })).toBe("before_dock_call");
    expect(gate({ dockCallMinutes: 120, now: ninetyMinutesOut })).toBe("eligible");
  });

  it("closes when the counter stops looking backwards", () => {
    expect(gate({ now: new Date(DEPARTURE.getTime() + 6 * HOUR_MS) })).toBe("eligible");
    expect(gate({ now: new Date(DEPARTURE.getTime() + 6 * HOUR_MS + MINUTE_MS) })).toBe(
      "window_closed",
    );
  });

  it("stays open for a diver who checked in at the desk and then never boarded", () => {
    expect(gate({ bookingStatus: "checked_in" })).toBe("eligible");
  });

  /**
   * **The refusal this gate exists for.** A diver the crew recorded aboard is
   * on the water; marking them absent would take a person the manifest is
   * holding off the expected list. It is checked ahead of every other
   * condition so nothing — a cancelled trip, a closed window, a second tap —
   * can answer first and hide it.
   */
  it("never lets a boarded diver be marked absent, whatever else is true", () => {
    expect(gate({ boarded: true })).toBe("already_boarded");
    expect(gate({ boarded: true, bookingStatus: "no_show" })).toBe("already_boarded");
    expect(gate({ boarded: true, bookingStatus: "cancelled" })).toBe("already_boarded");
    expect(gate({ boarded: true, tripStatus: "cancelled" })).toBe("already_boarded");
    expect(gate({ boarded: true, now: new Date(DEPARTURE.getTime() - 3 * HOUR_MS) })).toBe(
      "already_boarded",
    );
    expect(gate({ boarded: true, now: new Date(DEPARTURE.getTime() + 12 * HOUR_MS) })).toBe(
      "already_boarded",
    );
  });

  it("refuses a seat that is already marked, or was given up", () => {
    expect(gate({ bookingStatus: "no_show" })).toBe("already_marked");
    expect(gate({ bookingStatus: "cancelled" })).toBe("not_booked");
  });

  it("refuses a departure the weather called off", () => {
    expect(gate({ tripStatus: "cancelled" })).toBe("trip_cancelled");
  });
});

describe("seatIsHeld", () => {
  it("counts the two statuses that hold a seat, and no others", () => {
    expect(seatIsHeld("booked")).toBe(true);
    expect(seatIsHeld("checked_in")).toBe(true);
    // The boundary this ticket settles: a recorded no-show is the shop's seat
    // to sell, which is what makes the wait-list invite beside it honest.
    expect(seatIsHeld("no_show")).toBe(false);
    expect(seatIsHeld("cancelled")).toBe(false);
  });
});

describe("salvageOffer", () => {
  const alternative: SimilarDeparture = {
    tripId: "trip-2",
    title: "Two-Tank Reef",
    startsAt: new Date("2026-09-12T14:00:00.000Z"),
    reason: "same_site",
  };

  it("offers the wait list first — those divers asked for this exact boat", () => {
    expect(salvageOffer({ waitlistCount: 3, alternatives: [alternative] })).toEqual({
      kind: "waitlist",
      count: 3,
    });
  });

  it("falls back to a similar departure when nobody is waiting", () => {
    expect(salvageOffer({ waitlistCount: 0, alternatives: [alternative] })).toEqual({
      kind: "alternative",
      departures: [alternative],
    });
  });

  it("offers nothing rather than inventing something", () => {
    expect(salvageOffer({ waitlistCount: 0, alternatives: [] })).toEqual({ kind: "none" });
  });
});
