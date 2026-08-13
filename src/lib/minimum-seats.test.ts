import { describe, expect, it } from "vitest";
import {
  effectiveMinimum,
  MINIMUM_SEATS_DECISION_HOURS_DEFAULT,
  minimumSeatsDecisionAt,
  minimumSeatsState,
} from "./minimum-seats";

const startsAt = new Date("2026-08-20T11:30:00Z");
const trip = (over: Partial<Parameters<typeof minimumSeatsState>[0]> = {}) => ({
  startsAt,
  capacity: 9,
  minimumBookings: 4,
  minimumDecisionHours: 24,
  ...over,
});

describe("minimumSeatsDecisionAt", () => {
  it("counts back from departure, not forward from now", () => {
    expect(minimumSeatsDecisionAt(trip())).toEqual(new Date("2026-08-19T11:30:00Z"));
  });

  it("falls back to the default window when the shop named a minimum but no window", () => {
    expect(minimumSeatsDecisionAt(trip({ minimumDecisionHours: null }))).toEqual(
      new Date(startsAt.getTime() - MINIMUM_SEATS_DECISION_HOURS_DEFAULT * 3_600_000),
    );
  });

  it("has nothing to decide without a minimum", () => {
    expect(minimumSeatsDecisionAt(trip({ minimumBookings: null }))).toBeNull();
  });
});

describe("effectiveMinimum", () => {
  it("passes a reachable minimum through", () => {
    expect(effectiveMinimum({ minimumBookings: 4, minimumDecisionHours: null }, 9)).toBe(4);
  });

  /**
   * A shop that set a minimum of 6 and later dropped the boat to a 4-seat RIB
   * has written a departure that could never run. Clamping to capacity reads
   * that as "every seat", which is the fail-open direction; the alternative is
   * a trip the sweep cancels the moment its deadline lands, whatever anybody
   * does about it.
   */
  it("clamps a minimum the boat can no longer hold down to its capacity", () => {
    expect(effectiveMinimum({ minimumBookings: 6, minimumDecisionHours: null }, 4)).toBe(4);
  });

  it("stays out of the way when there is no minimum", () => {
    expect(effectiveMinimum({ minimumBookings: null, minimumDecisionHours: 24 }, 9)).toBeNull();
  });
});

describe("minimumSeatsState", () => {
  const before = new Date("2026-08-18T00:00:00Z");
  const after = new Date("2026-08-19T12:00:00Z");

  it("says nothing about a departure with no minimum", () => {
    expect(minimumSeatsState(trip({ minimumBookings: null }), 0, before)).toEqual({ kind: "none" });
  });

  it("is met the moment the seats are sold, deadline or not", () => {
    expect(minimumSeatsState(trip(), 4, after)).toEqual({
      kind: "met",
      minimum: 4,
      decidesAt: new Date("2026-08-19T11:30:00Z"),
    });
  });

  it("is short — with the shortfall — before the deadline", () => {
    expect(minimumSeatsState(trip(), 1, before)).toEqual({
      kind: "short",
      minimum: 4,
      shortfall: 3,
      decidesAt: new Date("2026-08-19T11:30:00Z"),
    });
  });

  it("is due once the deadline has passed and it is still short", () => {
    expect(minimumSeatsState(trip(), 1, after)).toMatchObject({ kind: "due", shortfall: 3 });
  });

  /**
   * The boundary the sweep and every surface have to agree on. A trip whose
   * deadline falls exactly now is already due: the sweep's SQL uses `<=`, and a
   * screen reading "short" about a departure the next pass will cancel is a
   * page disagreeing with the database.
   */
  it("is due, not short, exactly at the deadline", () => {
    expect(minimumSeatsState(trip(), 1, new Date("2026-08-19T11:30:00Z")).kind).toBe("due");
  });

  it("measures the shortfall against the clamped minimum, not the stored one", () => {
    expect(minimumSeatsState(trip({ minimumBookings: 20, capacity: 6 }), 2, before)).toMatchObject({
      minimum: 6,
      shortfall: 4,
    });
  });
});
