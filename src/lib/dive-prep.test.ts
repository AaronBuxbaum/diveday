import { describe, expect, it } from "vitest";
import { buildDivePrepChecklist, type PrepDiver, type RentalFit, rentalFitLine } from "./dive-prep";

const fullFit: RentalFit = {
  rentsBcd: true,
  rentsRegulator: true,
  rentsWetsuit: true,
  rentsMaskFins: true,
  rentsWeights: true,
  rentsDiveComputer: false,
  rentsGopro: false,
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
    personId: overrides.bookingId,
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

describe("rented add-ons on the prep list", () => {
  it("packs a dive computer and a GoPro, unsized, only when rented", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Priya Sharma",
          fit: { ...fullFit, rentsDiveComputer: true, rentsGopro: true },
        }),
        // Ana rents neither add-on.
        diver({ bookingId: "b2", fullName: "Ana Ruiz" }),
      ],
      plannedDives: 1,
    });
    expect(lineFor(checklist, "dive_computer", null)).toMatchObject({
      count: 1,
      divers: ["Priya Sharma"],
    });
    expect(lineFor(checklist, "gopro", null)).toMatchObject({ count: 1, divers: ["Priya Sharma"] });
  });

  it("reads the add-ons in the one-line fit summary", () => {
    const line = rentalFitLine({ ...fullFit, rentsDiveComputer: true, rentsGopro: true });
    expect(line.state).toBe("rents");
    const kinds = line.state === "rents" ? line.items.map((item) => item.kind) : [];
    expect(kinds).toContain("dive_computer");
    expect(kinds).toContain("gopro");
  });
});

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
      { bookingId: "b1", personId: "b1", fullName: "Priya Sharma", reason: "no_verified_card" },
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
    expect(checklist.diversWithoutFit).toEqual([{ fullName: "Priya Sharma", personId: "b1" }]);
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

describe("needs-staff-fit fallback (H-06)", () => {
  const flaggedAt = new Date("2026-07-24T12:00:00Z");

  it("keeps a flagged diver's stated size off the lines but keeps their count", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Ada" }),
        diver({
          bookingId: "b2",
          fullName: "Ben",
          fit: { ...fullFit, needsStaffFitAt: flaggedAt, needsStaffFitNote: "No L BCD" },
        }),
      ],
      plannedDives: 2,
      now: flaggedAt,
    });
    // Ben's BCD is not laid out in his stated size — that is what the flag
    // prevents...
    expect(lineFor(checklist, "bcd", "M")?.divers).toEqual(["Ada"]);
    // ...but he still gets a BCD line, so the boat isn't loaded one short.
    const benBcd = checklist.lines.find((l) => l.kind === "bcd" && l.fitAtCheckIn);
    expect(benBcd).toMatchObject({ count: 1, divers: ["Ben"], size: null });
    // The sizes he asked for ride along: the captain doing the check-in fit
    // can't edit the profile and sees no size on the line above, so without
    // this there is nothing to bring a range around.
    expect(checklist.diversNeedingStaffFit).toEqual([
      {
        personId: "b2",
        fullName: "Ben",
        note: "No L BCD",
        statedSizes: [
          { kind: "bcd", size: "M" },
          { kind: "wetsuit", size: "5mm M" },
          { kind: "boots", size: "9" },
          { kind: "mask_fins", size: "M" },
        ],
        flaggedDaysAgo: 0,
      },
    ]);
    // ...and he is not miscounted as a diver nobody ever asked.
    expect(checklist.diversWithoutFit).toEqual([]);
  });

  it("never drops a flagged diver's unsized life support", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Ben",
          fit: { ...fullFit, rentsDiveComputer: true, needsStaffFitAt: flaggedAt },
        }),
      ],
      plannedDives: 1,
      now: flaggedAt,
    });
    // A regulator has no size to be wrong about. Leaving one off the boat to
    // avoid packing a wrong-size wetsuit is the strictly worse trade.
    expect(lineFor(checklist, "regulator", null)).toMatchObject({
      count: 1,
      divers: ["Ben"],
      fitAtCheckIn: false,
    });
    expect(lineFor(checklist, "dive_computer", null)?.count).toBe(1);
  });

  it("keeps a flagged diver's usual weighting — lead is bulk, not a size", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Ben",
          fit: { ...fullFit, weightPreference: "6 kg", needsStaffFitAt: flaggedAt },
        }),
      ],
      plannedDives: 1,
      now: flaggedAt,
    });
    // A shop is never "out of 6 kg" — lead comes in 2 lb increments — and usual
    // weighting is the most safety-relevant number in the fit: under-weighted
    // is a diver who can't hold a safety stop, over-weighted is a bad ascent.
    // Blanking it because there's no L BCD trades a real number for nothing.
    expect(lineFor(checklist, "weights", "6 kg")).toMatchObject({
      count: 1,
      divers: ["Ben"],
      fitAtCheckIn: false,
    });
  });

  it("still counts a flagged diver's tanks — gas is never sized", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Ada" }),
        diver({
          bookingId: "b2",
          fullName: "Ben",
          fit: { ...fullFit, needsStaffFitAt: flaggedAt },
        }),
      ],
      plannedDives: 3,
      now: flaggedAt,
    });
    expect(checklist.tanks.total).toBe(6);
    expect(checklist.diverCount).toBe(2);
  });

  it("reports a flagged diver with no note as a bare name", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Ada",
          fit: { ...fullFit, needsStaffFitAt: flaggedAt, needsStaffFitNote: "   " },
        }),
      ],
      plannedDives: 1,
      now: flaggedAt,
    });
    expect(checklist.diversNeedingStaffFit).toEqual([
      {
        personId: "b1",
        fullName: "Ada",
        note: null,
        statedSizes: [
          { kind: "bcd", size: "M" },
          { kind: "wetsuit", size: "5mm M" },
          { kind: "boots", size: "9" },
          { kind: "mask_fins", size: "M" },
        ],
        flaggedDaysAgo: 0,
      },
    ]);
  });

  it("reports how stale the flag is, so an old one prompts a re-ask", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Ada",
          fit: { ...fullFit, needsStaffFitAt: flaggedAt },
        }),
      ],
      plannedDives: 1,
      now: new Date(flaggedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(checklist.diversNeedingStaffFit[0]?.flaggedDaysAgo).toBe(30);
  });
});

describe("rentalFitLine", () => {
  it("reads as a packing line for one diver", () => {
    // A code + params (item kinds and sizes), never a rendered sentence — the
    // caller resolves each item's word through its own bundle
    // (src/i18n/rental-labels.ts's `rentalFitLineText` for staff surfaces).
    expect(rentalFitLine(fullFit)).toEqual({
      state: "rents",
      items: [
        { kind: "bcd", size: "M" },
        { kind: "regulator", size: null },
        { kind: "wetsuit", size: "5mm M" },
        { kind: "boots", size: "9" },
        { kind: "mask_fins", size: "M" },
        { kind: "weights", size: "6 kg" },
      ],
    });
  });

  it("distinguishes a diver who brings their own kit from one nobody asked", () => {
    // Collapsing these two reads as reassurance the shop has not earned.
    expect(rentalFitLine(null)).toEqual({ state: "not_recorded" });
    expect(
      rentalFitLine({
        ...fullFit,
        rentsBcd: false,
        rentsRegulator: false,
        rentsWetsuit: false,
        rentsMaskFins: false,
        rentsWeights: false,
      }),
    ).toEqual({ state: "own_kit" });
  });

  it("reads a flagged diver as an open job, not a size to hand over", () => {
    const flaggedAt = new Date("2026-07-24T12:00:00Z");
    expect(rentalFitLine({ ...fullFit, needsStaffFitAt: flaggedAt })).toEqual({
      state: "needs_staff_fit",
      note: null,
    });
    // The note rides along so the dock knows what's short without a click.
    expect(
      rentalFitLine({ ...fullFit, needsStaffFitAt: flaggedAt, needsStaffFitNote: "No L BCD" }),
    ).toEqual({ state: "needs_staff_fit", note: "No L BCD" });
  });
});
