import { describe, expect, it } from "vitest";
import { type CrewDeparture, crewCollisions } from "./rules";

const window = (start: string, end: string) => ({
  startsAt: new Date(start),
  endsAt: new Date(end),
});
const morning = window("2026-08-04T08:00:00Z", "2026-08-04T12:00:00Z");
const departure = (overrides: Partial<CrewDeparture> = {}): CrewDeparture => ({
  tripId: "one",
  status: "scheduled",
  windows: [morning],
  crewIds: ["crew"],
  ...overrides,
});

describe("crewCollisions", () => {
  it.each([
    {
      name: "overlap",
      other: departure({
        tripId: "two",
        windows: [window("2026-08-04T11:00:00Z", "2026-08-04T14:00:00Z")],
      }),
      expected: 1,
    },
    {
      name: "touching endpoints",
      other: departure({
        tripId: "two",
        windows: [window("2026-08-04T12:00:00Z", "2026-08-04T14:00:00Z")],
      }),
      expected: 0,
    },
    {
      name: "different crew",
      other: departure({ tripId: "two", crewIds: ["other"] }),
      expected: 0,
    },
    { name: "cancelled", other: departure({ tripId: "two", status: "cancelled" }), expected: 0 },
    { name: "same departure", other: departure(), expected: 0 },
    {
      name: "later leg",
      other: departure({
        tripId: "two",
        windows: [window("2026-08-05T08:00:00Z", "2026-08-05T12:00:00Z"), morning],
      }),
      expected: 1,
    },
    {
      name: "multiple overlapping legs",
      other: departure({ tripId: "two", windows: [morning, morning], crewIds: ["crew", "crew"] }),
      expected: 1,
    },
  ])("handles $name", ({ other, expected }) => {
    expect(crewCollisions(departure(), other)).toHaveLength(expected);
  });

  it("returns each shared person once", () => {
    expect(
      crewCollisions(
        departure({ crewIds: ["a", "b"] }),
        departure({ tripId: "two", crewIds: ["b", "a"] }),
      ),
    ).toEqual(["a", "b"]);
  });
});
