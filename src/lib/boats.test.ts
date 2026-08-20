import { describe, expect, it } from "vitest";
import { maxConcurrentTrips } from "./boats";

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
