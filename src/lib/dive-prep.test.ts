import { describe, expect, it } from "vitest";
import { buildDivePrepChecklist, type PrepDiver, type RentalFit, rentalFitLine } from "./dive-prep";

const fullFit: RentalFit = {
  rentsBcd: true,
  rentsRegulator: true,
  rentsWetsuit: true,
  rentsMaskFins: true,
  rentsWeights: true,
  bcdSize: "M",
  wetsuitSize: "5mm M",
  bootSize: "9",
  finSize: "M",
  weightPreference: "6 kg",
};

function diver(
  overrides: Partial<PrepDiver> & Pick<PrepDiver, "bookingId" | "fullName">,
): PrepDiver {
  return {
    fit: fullFit,
    wantsNitrox: false,
    hasVerifiedNitroxCard: false,
    ...overrides,
  };
}

function lineFor(
  checklist: ReturnType<typeof buildDivePrepChecklist>,
  kind: string,
  size: string | null,
) {
  return checklist.lines.find((line) => line.kind === kind && line.size === size);
}

describe("buildDivePrepChecklist tanks", () => {
  it("plans one tank per diver per planned dive", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma" }),
        diver({ bookingId: "b2", fullName: "Ana Ruiz" }),
      ],
      plannedDives: 3,
    });
    expect(checklist.tanks).toEqual({ total: 6, air: 6, nitrox: 0 });
  });

  it("counts nitrox tanks only for a diver with a verified card", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Priya Sharma",
          wantsNitrox: true,
          hasVerifiedNitroxCard: true,
        }),
        diver({ bookingId: "b2", fullName: "Ana Ruiz" }),
      ],
      plannedDives: 2,
    });
    expect(checklist.tanks).toEqual({ total: 4, air: 2, nitrox: 2 });
    expect(checklist.nitroxBlockers).toEqual([]);
  });

  it("downgrades an unverified nitrox request to air and names it as a blocker", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Priya Sharma",
          wantsNitrox: true,
          hasVerifiedNitroxCard: false,
        }),
      ],
      plannedDives: 2,
    });
    expect(checklist.tanks).toEqual({ total: 2, air: 2, nitrox: 0 });
    expect(checklist.nitroxBlockers).toEqual([
      { bookingId: "b1", fullName: "Priya Sharma", reason: "no_verified_card" },
    ]);
  });

  it("never plans fewer than one dive, whatever the trip claims", () => {
    for (const plannedDives of [0, -4, Number.NaN]) {
      const checklist = buildDivePrepChecklist({
        divers: [diver({ bookingId: "b1", fullName: "Priya Sharma" })],
        plannedDives,
      });
      expect(checklist.diveCount).toBe(1);
      expect(checklist.tanks.total).toBe(1);
    }
  });

  it("has nothing to prepare for an empty roster", () => {
    const checklist = buildDivePrepChecklist({ divers: [], plannedDives: 2 });
    expect(checklist.tanks).toEqual({ total: 0, air: 0, nitrox: 0 });
    expect(checklist.lines).toEqual([]);
  });

  it("adds one air tank per planned dive for each diving crew member", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Priya Sharma" })],
      plannedDives: 2,
      divingCrew: ["Marcus Webb"],
    });
    expect(checklist.crewCount).toBe(1);
    expect(checklist.tanks).toEqual({ total: 4, air: 4, nitrox: 0 });
  });

  it("counts crew tanks even with no divers booked yet", () => {
    const checklist = buildDivePrepChecklist({
      divers: [],
      plannedDives: 2,
      divingCrew: ["Marcus Webb", "Ana Ruiz"],
    });
    expect(checklist.crewCount).toBe(2);
    expect(checklist.tanks).toEqual({ total: 4, air: 4, nitrox: 0 });
  });
});

describe("buildDivePrepChecklist rental lines", () => {
  it("groups identical items and sizes, listing who each is for", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma" }),
        diver({ bookingId: "b2", fullName: "Ana Ruiz" }),
        diver({
          bookingId: "b3",
          fullName: "Tom Vale",
          fit: { ...fullFit, wetsuitSize: "5mm L", bcdSize: "L" },
        }),
      ],
      plannedDives: 1,
    });
    expect(lineFor(checklist, "wetsuit", "5mm M")).toMatchObject({
      count: 2,
      divers: ["Ana Ruiz", "Priya Sharma"],
    });
    expect(lineFor(checklist, "wetsuit", "5mm L")).toMatchObject({
      count: 1,
      divers: ["Tom Vale"],
    });
  });

  it("treats sizes case-insensitively when grouping", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma", fit: { ...fullFit, bcdSize: "m" } }),
        diver({ bookingId: "b2", fullName: "Ana Ruiz", fit: { ...fullFit, bcdSize: "M" } }),
      ],
      plannedDives: 1,
    });
    expect(checklist.lines.filter((line) => line.kind === "bcd")).toHaveLength(1);
  });

  it("omits kit the diver owns, but still lists boots with no size recorded", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Priya Sharma",
          fit: { ...fullFit, rentsRegulator: false, rentsWeights: false, bootSize: "  " },
        }),
      ],
      plannedDives: 1,
    });
    // Fins don't fit over bare feet: a blank boot size is a loose end to chase,
    // not a reason to send the diver to the dock without boots.
    expect(checklist.lines.map((line) => line.kind)).toEqual([
      "bcd",
      "wetsuit",
      "boots",
      "mask_fins",
    ]);
    expect(lineFor(checklist, "boots", null)).toMatchObject({ count: 1 });
  });

  it("keeps a diver with no fit on file visible instead of dropping them", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma", fit: null }),
        diver({ bookingId: "b2", fullName: "Ana Ruiz" }),
      ],
      plannedDives: 2,
    });
    expect(checklist.diversWithoutFit).toEqual(["Priya Sharma"]);
    expect(checklist.tanks.total).toBe(4);
    expect(lineFor(checklist, "bcd", "M")?.divers).toEqual(["Ana Ruiz"]);
  });

  it("sorts by kind and pushes an unrecorded size to the end of its kind", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma", fit: { ...fullFit, bcdSize: null } }),
        diver({ bookingId: "b2", fullName: "Ana Ruiz", fit: { ...fullFit, bcdSize: "S" } }),
      ],
      plannedDives: 1,
    });
    const bcd = checklist.lines.filter((line) => line.kind === "bcd");
    expect(bcd.map((line) => line.size)).toEqual(["S", null]);
    expect(checklist.lines[0]?.kind).toBe("bcd");
    expect(checklist.lines.at(-1)?.kind).toBe("weights");
  });
});

describe("rentalFitLine", () => {
  it("reads as a packing line for one diver", () => {
    expect(rentalFitLine(fullFit)).toEqual({
      state: "rents",
      text: "BCD M, Regulator, Wetsuit 5mm M, Boots 9, Mask & fins M, Weights 6 kg",
    });
  });

  it("distinguishes a diver who brings their own kit from one nobody asked", () => {
    // Collapsing these two reads as reassurance the shop has not earned.
    expect(rentalFitLine(null).state).toBe("not_recorded");
    expect(rentalFitLine(null).text).toContain("not asked");
    expect(
      rentalFitLine({
        ...fullFit,
        rentsBcd: false,
        rentsRegulator: false,
        rentsWetsuit: false,
        rentsMaskFins: false,
        rentsWeights: false,
      }),
    ).toEqual({ state: "own_kit", text: "Own kit" });
  });
});
