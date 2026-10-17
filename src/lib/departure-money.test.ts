import { describe, expect, it } from "vitest";
import { moneyByBoat, moneyByKind } from "./departure-money";

const trip = (overrides: Partial<Parameters<typeof moneyByBoat>[0][number]> = {}) => ({
  startsAt: new Date("2026-10-03T12:00:00Z"),
  capacity: 12,
  activeBookings: 9,
  netCents: 85_500,
  boatName: "Mantis I",
  kindName: "Two-tank reef",
  isCourse: false,
  ...overrides,
});

describe("moneyByBoat", () => {
  it("counts days at sea, not departures, and sums seats and money per hull", () => {
    const lines = moneyByBoat(
      [
        trip(),
        // Same local day, an afternoon trip: one day at sea.
        trip({ startsAt: new Date("2026-10-03T18:00:00Z"), activeBookings: 3, netCents: 20_000 }),
        trip({ startsAt: new Date("2026-10-04T12:00:00Z"), netCents: 10_000 }),
        trip({ boatName: "Mantis II", netCents: 140_000, activeBookings: 6, capacity: 12 }),
      ],
      "America/New_York",
    );
    expect(lines).toEqual([
      { name: "Mantis II", days: 1, booked: 6, seats: 12, netCents: 140_000 },
      { name: "Mantis I", days: 2, booked: 21, seats: 36, netCents: 115_500 },
    ]);
  });

  it("leaves a departure with no boat out of every hull's line", () => {
    expect(moneyByBoat([trip({ boatName: null })], "UTC")).toEqual([]);
  });
});

describe("moneyByKind", () => {
  it("groups by the shop's own word, courses apart, highest take first", () => {
    const lines = moneyByKind([
      trip({ kindName: "Wreck", netCents: 162_000 }),
      trip({ netCents: 398_000 }),
      trip({ isCourse: true, kindName: "Two-tank reef", netCents: 34_000 }),
      trip({ kindName: null, netCents: 5_000 }),
    ]);
    expect(lines).toEqual([
      { kind: { kind: "lens", name: "Two-tank reef" }, netCents: 398_000 },
      { kind: { kind: "lens", name: "Wreck" }, netCents: 162_000 },
      { kind: { kind: "course" }, netCents: 34_000 },
      { kind: { kind: "other" }, netCents: 5_000 },
    ]);
  });

  it("says nothing when no departure named a kind", () => {
    expect(moneyByKind([trip({ kindName: null })])).toEqual([]);
  });
});
