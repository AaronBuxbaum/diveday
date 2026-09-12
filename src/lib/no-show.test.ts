import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "./clock";
import { type NoShowGateInput, noShowClaim, noShowGate, salvageOffer, seatIsHeld } from "./no-show";
import type { SimilarDeparture } from "./similar-departures";

const DEPARTURE = new Date("2026-09-11T14:00:00.000Z");

function gate(overrides: Partial<NoShowGateInput> = {}) {
  return noShowGate({
    bookingStatus: "booked",
    boarded: false,
    tripStatus: "scheduled",
    startsAt: DEPARTURE,
    now: new Date(DEPARTURE.getTime() + 10 * MINUTE_MS),
    ...overrides,
  });
}

describe("noShowGate", () => {
  /**
   * **The opening the dive-domain-expert review moved** (2026-09-11). It sat at
   * the shop's dock call, which is when the diver was *asked* to be there —
   * but this tap does not write "late", it writes "did not come", and at the
   * dock call half the manifest is still in the car park.
   */
  it("opens when the boat leaves without them, not when the shop asked them to be there", () => {
    expect(gate({ now: new Date(DEPARTURE.getTime() - 30 * MINUTE_MS) })).toBe("before_departure");
    expect(gate({ now: new Date(DEPARTURE.getTime() - MINUTE_MS) })).toBe("before_departure");
    expect(gate({ now: DEPARTURE })).toBe("eligible");
  });

  /**
   * `dock_call_minutes` is the shop's diver-facing arrival time, and this gate
   * no longer reads it: a shop that asks divers to be there two hours early
   * does not thereby get two hours of "Not here?" over divers who are not late
   * at all. `NoShowGateInput` has no field left to pass it through.
   */
  it("gives a shop with a long dock call no earlier door than a shop without one", () => {
    expect(gate({ now: new Date(DEPARTURE.getTime() - 120 * MINUTE_MS) })).toBe("before_departure");
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
   * **The refusal this gate exists for.** A diver the crew's roll call puts on
   * the water — counted aboard, or recorded as not back from a dive — is a
   * person the manifest is holding, and marking them absent takes them off the
   * expected list. It is checked ahead of every other condition so nothing —
   * a cancelled trip, a closed window, a second tap — can answer first and
   * hide it.
   *
   * Which of the crew's two statements produced the `true` is decided one layer
   * down, in `onTheWaterByRollCall` (src/db/manifests.ts), because only a
   * reader of `roll_call_events` can tell a dock `not_boarded` ("never left")
   * from an after-dive one ("did not come back"). This gate is handed the fact.
   */
  it("never lets a diver the roll call puts on the water be marked absent", () => {
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

/**
 * **The same tap, two claims** (dive-domain-expert review, 2026-09-11). Before
 * the boat is gone the mark is about a seat the shop can still sell, over a
 * diver who may yet come running down the dock. After it, the seat is worth
 * nothing and the mark is a statement about a person that seven readers spend,
 * which is why the counter says a different sentence over it.
 */
describe("noShowClaim", () => {
  it("is about the seat while the boat is still there, late included", () => {
    expect(noShowClaim({ startsAt: DEPARTURE, now: DEPARTURE })).toBe("frees_seat");
    // The hour every "has it sailed?" question in this codebase allows,
    // because boats run late (`hasSailed`, src/lib/trips.ts).
    expect(
      noShowClaim({
        startsAt: DEPARTURE,
        now: new Date(DEPARTURE.getTime() + HOUR_MS - MINUTE_MS),
      }),
    ).toBe("frees_seat");
  });

  it("is about the person once the boat has gone", () => {
    expect(noShowClaim({ startsAt: DEPARTURE, now: new Date(DEPARTURE.getTime() + HOUR_MS) })).toBe(
      "did_not_dive",
    );
    expect(
      noShowClaim({ startsAt: DEPARTURE, now: new Date(DEPARTURE.getTime() + 5 * HOUR_MS) }),
    ).toBe("did_not_dive");
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

  // The second offer is about the diver, not the seat: nobody else can take a
  // seat on a different boat, so what is left to salvage is the day of the
  // person the seat was taken from (dive-domain-expert review, 2026-09-11).
  it("offers the diver who missed another day when nobody is waiting", () => {
    expect(salvageOffer({ waitlistCount: 0, alternatives: [alternative] })).toEqual({
      kind: "rebook",
      departures: [alternative],
    });
  });

  it("offers nothing rather than inventing something", () => {
    expect(salvageOffer({ waitlistCount: 0, alternatives: [] })).toEqual({ kind: "none" });
  });
});
