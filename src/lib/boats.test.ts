import { describe, expect, it } from "vitest";
import { maxConcurrentTrips, overlappingBoatIds } from "./boats";

describe("maxConcurrentTrips", () => {
  it("returns 0 for empty list and 1 for a single trip", () => {
    expect(maxConcurrentTrips([])).toBe(0);
    expect(
      maxConcurrentTrips([
        {
          startsAt: new Date("2026-08-17T08:00:00Z"),
          endsAt: new Date("2026-08-17T11:00:00Z"),
        },
      ]),
    ).toBe(1);
  });

  it("returns 1 when trips on the same day do not overlap in time", () => {
    const morning = {
      startsAt: new Date("2026-08-17T08:00:00Z"),
      endsAt: new Date("2026-08-17T11:00:00Z"),
    };
    const afternoon = {
      startsAt: new Date("2026-08-17T14:00:00Z"),
      endsAt: new Date("2026-08-17T17:00:00Z"),
    };
    expect(maxConcurrentTrips([morning, afternoon])).toBe(1);
  });

  it("does not count touching boundary times as overlapping (11:00 end and 11:00 start)", () => {
    const trip1 = {
      startsAt: new Date("2026-08-17T08:00:00Z"),
      endsAt: new Date("2026-08-17T11:00:00Z"),
    };
    const trip2 = {
      startsAt: new Date("2026-08-17T11:00:00Z"),
      endsAt: new Date("2026-08-17T14:00:00Z"),
    };
    expect(maxConcurrentTrips([trip1, trip2])).toBe(1);
  });

  it("detects genuine concurrency when intervals overlap", () => {
    const trip1 = {
      startsAt: new Date("2026-08-17T08:00:00Z"),
      endsAt: new Date("2026-08-17T12:00:00Z"),
    };
    const trip2 = {
      startsAt: new Date("2026-08-17T10:00:00Z"),
      endsAt: new Date("2026-08-17T14:00:00Z"),
    };
    const trip3 = {
      startsAt: new Date("2026-08-17T15:00:00Z"),
      endsAt: new Date("2026-08-17T18:00:00Z"),
    };
    expect(maxConcurrentTrips([trip1, trip2, trip3])).toBe(2);
  });

  it("calculates peak concurrency with 3 simultaneous trips", () => {
    const trip1 = {
      startsAt: new Date("2026-08-17T08:00:00Z"),
      endsAt: new Date("2026-08-17T13:00:00Z"),
    };
    const trip2 = {
      startsAt: new Date("2026-08-17T09:00:00Z"),
      endsAt: new Date("2026-08-17T12:00:00Z"),
    };
    const trip3 = {
      startsAt: new Date("2026-08-17T10:00:00Z"),
      endsAt: new Date("2026-08-17T14:00:00Z"),
    };
    expect(maxConcurrentTrips([trip1, trip2, trip3])).toBe(3);
  });
});

/**
 * **A hull cannot be in two places at once, and until now nothing said so.**
 *
 * `maxConcurrentTrips` counts *simultaneous departures* and the board compares
 * that peak against how many hulls the shop owns. It never looks at which boat
 * each departure is assigned to — so a shop with two hulls that schedules an
 * 8:00–12:00 and a 9:00–13:00 **both on Reef Runner** gets a peak of 2 against
 * a fleet of 2 and hears nothing, while one vessel is booked to be in two
 * places (issue #677).
 *
 * The same shop *would* be warned for putting those departures on two different
 * boats and adding a third — the arrangement that is actually fine.
 *
 * These are separate questions and both are worth asking, so this is a second
 * function rather than a rewrite of the first: the fleet-size count is still the
 * only answer available for a departure with no hull assigned.
 */
describe("overlappingBoatIds", () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 6, 21, hour, 0, 0));
  const trip = (boatId: string | null, from: number, to: number) => ({
    boatId,
    startsAt: at(from),
    endsAt: at(to),
  });

  it("names a hull booked into two departures at once", () => {
    expect(overlappingBoatIds([trip("reef", 8, 12), trip("reef", 9, 13)])).toEqual(["reef"]);
  });

  it("says nothing when the overlap is across two different hulls", () => {
    // The arrangement that is actually fine, and the one the old check warned
    // about as soon as a third departure joined it.
    expect(overlappingBoatIds([trip("reef", 8, 12), trip("blue", 9, 13)])).toEqual([]);
  });

  it("lets one hull run twice in a day", () => {
    // Two tanks in the morning and a sunset dive is an ordinary day, not a
    // mistake — the two windows simply do not overlap.
    expect(overlappingBoatIds([trip("reef", 8, 12), trip("reef", 17, 20)])).toEqual([]);
  });

  it("treats a boundary touch as a turnaround, not an overlap", () => {
    // Same rule `maxConcurrentTrips` already states: 11:00 end and 11:00 start
    // is a boat coming back and going out again.
    expect(overlappingBoatIds([trip("reef", 8, 11), trip("reef", 11, 15)])).toEqual([]);
  });

  it("ignores departures with no hull assigned", () => {
    // They have no vessel to double-book. The fleet-size count is still their
    // only answer, which is why that check stays.
    expect(overlappingBoatIds([trip(null, 8, 12), trip(null, 9, 13)])).toEqual([]);
  });

  it("names each doubled hull once, however many departures pile up", () => {
    expect(
      overlappingBoatIds([
        trip("reef", 8, 12),
        trip("reef", 9, 13),
        trip("reef", 10, 14),
        trip("blue", 8, 12),
        trip("blue", 9, 13),
      ]).sort(),
    ).toEqual(["blue", "reef"]);
  });

  it("has nothing to say about a single departure", () => {
    expect(overlappingBoatIds([trip("reef", 8, 12)])).toEqual([]);
    expect(overlappingBoatIds([])).toEqual([]);
  });
});
