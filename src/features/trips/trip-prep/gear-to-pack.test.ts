import { describe, expect, it } from "vitest";
import { type GearToPackInput, gearToPack } from "./gear-to-pack";

const base: GearToPackInput = {
  checklist: {
    tanks: { total: 12, air: 10, nitrox: 2 },
    diverLines: [],
    lines: [],
    diversWithIncompleteFit: [],
    diversNeedingStaffFit: [],
  },
  hotelPickups: [],
  lunch: null,
};

const diver = (bookingId: string, fullName: string, state = "rents" as const) => ({
  bookingId,
  personId: `p-${bookingId}`,
  fullName,
  items: [],
  state,
  lastDivedBand: null,
});

describe("gearToPack", () => {
  it("counts the tanks by gas", () => {
    expect(gearToPack(base).tanks).toEqual({ air: 10, nitrox: 2 });
  });

  it("says how many rental sets are sized, and who is fitted at check-in", () => {
    const summary = gearToPack({
      ...base,
      checklist: {
        ...base.checklist,
        diverLines: [
          diver("a", "Ana"),
          diver("b", "Ben"),
          diver("c", "Cy"),
          diver("d", "Dee", "own_kit" as never),
          diver("e", "Eve", "not_recorded" as never),
        ],
        diversWithIncompleteFit: [
          { fullName: "Ben", personId: "p-b", state: "incomplete", missing: ["bcd"] },
          { fullName: "Eve", personId: "p-e", state: "not_recorded", missing: [] },
        ],
        diversNeedingStaffFit: [
          { personId: "p-c", fullName: "Cy", note: null, statedSizes: [], flaggedDaysAgo: 0 },
        ],
      },
    });
    expect(summary.rentals).toEqual({ total: 4, sized: 1, fitAtCheckIn: ["Cy"] });
  });

  it("names who has not said their weights, and leaves drysuit divers to the water", () => {
    const summary = gearToPack({
      ...base,
      checklist: {
        ...base.checklist,
        lines: [
          {
            kind: "weights",
            size: null,
            count: 2,
            divers: [
              { bookingId: "a", fullName: "Ana" },
              { bookingId: "b", fullName: "Ben" },
            ],
            fitAtCheckIn: false,
            drysuitWeightCheck: false,
          },
          {
            kind: "weights",
            size: null,
            count: 1,
            divers: [{ bookingId: "c", fullName: "Cy" }],
            fitAtCheckIn: false,
            drysuitWeightCheck: true,
          },
          {
            kind: "weights",
            size: "6 kg",
            count: 1,
            divers: [{ bookingId: "d", fullName: "Dee" }],
            fitAtCheckIn: false,
            drysuitWeightCheck: false,
          },
        ] as never,
      },
    });
    expect(summary.weights).toEqual({ unsaid: ["Ana", "Ben"] });
  });

  it("draws no weights line when nobody rents weights", () => {
    expect(gearToPack(base).weights).toBeNull();
  });

  it("carries lunch and pickups only where the shop uses them", () => {
    expect(gearToPack(base)).toMatchObject({ lunch: null, pickups: 0 });
    expect(
      gearToPack({
        ...base,
        lunch: { count: 14 } as never,
        hotelPickups: [{}, {}] as never,
      }),
    ).toMatchObject({ lunch: 14, pickups: 2 });
  });
});
