import { describe, expect, it } from "vitest";
import {
  buildDivePrepChecklist,
  buildHotelPickupList,
  isPrepGrouping,
  type PrepDiver,
  type RentalFit,
  rentalFitLine,
} from "./dive-prep";

const fullFit: RentalFit = {
  rentsBcd: true,
  rentsRegulator: true,
  rentsWetsuit: true,
  rentsMaskFins: true,
  rentsWeights: true,
  rentsDiveComputer: false,
  rentsGopro: false,
  rentsDrysuit: false,
  rentsHoodGloves: false,
  rentsTorch: false,
  rentsSmb: false,
  bcdSize: "M",
  wetsuitSize: "5mm M",
  drysuitSize: null,
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
    lastDivedBand: null,
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

describe("a note-only fit row", () => {
  it("packs nothing and reads as not recorded on the roster", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma" }),
        // Uma left a note on `/ready` and never opened the gear form.
        diver({ bookingId: "b2", fullName: "Unasked Uma", fit: { ...fullFit, fitStatedAt: null } }),
      ],
      plannedDives: 1,
    });

    // One BCD, not two: Uma contributes no pieces at all.
    expect(lineFor(checklist, "bcd", fullFit.bcdSize)).toMatchObject({ count: 1 });
    expect(checklist.diverLines.find((line) => line.fullName === "Unasked Uma")).toMatchObject({
      state: "not_recorded",
      items: [],
    });
  });
});

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

/**
 * **The whole product answer of issue 1414, and the reason these tests are loud.**
 *
 * A drysuit is sized on its own scale and contributes exactly ONE piece. It
 * deliberately does *not* copy `rentsWetsuit`, which pushes a suit *and* a
 * pair of boots from one shoe-size answer: most rental drysuits have their
 * boots vulcanised on, so they leave the wall with the suit and there is
 * nothing separate to pack. A future change that "fixes" the drysuit to match
 * the wetsuit shape arrives at the dock with boots nobody owns, and these
 * tests refuse it.
 *
 * The fleets that stock neoprene-sock suits worn with separate rock boots are
 * served by the size itself rather than by a second piece: `drysuitSize` is
 * free text staff-side and reaches the line verbatim, which the last test here
 * pins.
 */
describe("a drysuit on the prep list (issue 1414)", () => {
  /** Own kit except the drysuit, so only the piece under test is on the list. */
  const drysuitOnly = {
    ...fullFit,
    rentsBcd: false,
    rentsRegulator: false,
    rentsWetsuit: false,
    rentsMaskFins: false,
    rentsWeights: false,
    rentsDrysuit: true,
    drysuitSize: "ML",
  };

  it("packs one drysuit at its own size and no boots beside it", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitOnly })],
      plannedDives: 1,
    });
    expect(checklist.lines.map((line) => [line.kind, line.size])).toEqual([["drysuit", "ML"]]);
  });

  it("still packs a wetsuit renter's boots — the two shapes stay different", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Wet Wanda",
          fit: { ...drysuitOnly, rentsDrysuit: false, rentsWetsuit: true },
        }),
      ],
      plannedDives: 1,
    });
    expect(checklist.lines.map((line) => [line.kind, line.size])).toEqual([
      ["wetsuit", "5mm M"],
      ["boots", "9"],
    ]);
  });

  it("reaches the list unsized and names the diver as a loose end", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Sizeless Sam",
          fit: { ...drysuitOnly, drysuitSize: null },
        }),
      ],
      plannedDives: 1,
    });
    expect(lineFor(checklist, "drysuit", null)).toMatchObject({
      count: 1,
      divers: ["Sizeless Sam"],
    });
    expect(checklist.diversWithIncompleteFit).toEqual([
      { fullName: "Sizeless Sam", personId: "b1", state: "incomplete", missing: ["drysuit"] },
    ]);
  });

  it("sorts after boots and before mask and fins, every morning", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Dry Dana",
          fit: { ...fullFit, rentsDrysuit: true, drysuitSize: "ML" },
        }),
      ],
      plannedDives: 1,
    });
    expect(checklist.lines.map((line) => line.kind)).toEqual([
      "bcd",
      "regulator",
      "wetsuit",
      "boots",
      "drysuit",
      "mask_fins",
      "weights",
    ]);
  });

  it("carries the stated drysuit size to whoever does the hands-on fit", () => {
    const flaggedAt = new Date("2026-07-24T12:00:00Z");
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Flagged Fay",
          fit: { ...drysuitOnly, needsStaffFitAt: flaggedAt, needsStaffFitNote: "No ML" },
        }),
      ],
      plannedDives: 1,
      now: flaggedAt,
    });
    // The line carries no size — that is what the flag does — so the fitter
    // would otherwise have nothing to start from.
    expect(checklist.lines[0]).toMatchObject({ kind: "drysuit", size: null, fitAtCheckIn: true });
    expect(checklist.diversNeedingStaffFit[0]?.statedSizes).toEqual([
      { kind: "drysuit", size: "ML" },
    ]);
  });
});

/**
 * **A drysuit diver never gets a wetsuit's number.** `weightPreference` is one
 * free-text answer to a question both fit forms ask against a wetsuit
 * ("Usually 12 lb with 3 mm suit"), so on a drysuit it is short by the two to
 * four kilos the suit and its undergarment add. Short is the direction that
 * cannot hold a safety stop on a near-empty tank in a suit the diver cannot
 * fully vent, and a crew reading "Drysuit ML" five lines above "Weights 12 lb
 * with 3 mm suit" gets no signal that the number was stated for another suit.
 * These tests refuse it.
 */
describe("weighting a diver in a drysuit", () => {
  const drysuitDiver = {
    ...fullFit,
    rentsDrysuit: true,
    drysuitSize: "ML",
    rentsWeights: true,
    weightPreference: "12 lb with 3 mm suit",
  };

  it("never puts the stated wetsuit number on a packing line", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
    });
    expect(lineFor(checklist, "weights", null)).toMatchObject({
      count: 1,
      size: null,
      drysuitWeightCheck: true,
      divers: ["Dry Dana"],
    });
    // Not anywhere else on the list either: both groupings are built from the
    // same pieces, and one of them printing it would be the whole bug.
    expect(checklist.lines.some((line) => line.size === "12 lb with 3 mm suit")).toBe(false);
    const weights = checklist.diverLines[0]?.items.find((piece) => piece.kind === "weights");
    expect(weights).toMatchObject({ size: null, drysuitWeightCheck: true });
  });

  it("keeps the number off the roll call and the offline manifest too", () => {
    // `rentalFitLine` is what the rail reads (DiverRollCall, OfflineManifestView)
    // and it is built from the same pieces, so it cannot print a number the
    // packing list refused.
    const line = rentalFitLine(drysuitDiver);
    const items = line.state === "rents" ? line.items : [];
    expect(items.find((item) => item.kind === "weights")).toEqual({ kind: "weights", size: null });
  });

  it("still packs a wetsuit diver to their stated number", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Wet Wanda",
          fit: { ...drysuitDiver, rentsDrysuit: false, drysuitSize: null },
        }),
      ],
      plannedDives: 1,
    });
    expect(lineFor(checklist, "weights", "12 lb with 3 mm suit")).toMatchObject({
      count: 1,
      drysuitWeightCheck: false,
    });
  });

  it("marks the check even when nobody stated a weighting at all", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Dry Dana",
          fit: { ...drysuitDiver, weightPreference: null },
        }),
      ],
      plannedDives: 1,
    });
    // The suit is the reason, not the missing answer: a drysuit is weighted in
    // the water whether or not the diver ever wrote a number down.
    expect(lineFor(checklist, "weights", null)).toMatchObject({ drysuitWeightCheck: true });
  });

  it("keeps the in-water check apart from a weighting nobody recorded", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver }),
        diver({
          bookingId: "b2",
          fullName: "Unasked Uma",
          fit: { ...fullFit, weightPreference: null },
        }),
      ],
      plannedDives: 1,
    });
    // Two blank sizes, two different jobs at the dock: collapsed into one row
    // of two, the packer is told neither.
    const weights = checklist.lines.filter((line) => line.kind === "weights");
    expect(weights.map((line) => [line.drysuitWeightCheck, line.count, line.divers])).toEqual([
      [true, 1, ["Dry Dana"]],
      [false, 1, ["Unasked Uma"]],
    ]);
  });
});

/**
 * **Fins packed to a shoe size do not go over a drysuit boot.** Both fit forms
 * ask one question for them — "Fin & boot size", placeholder "US 9 / EU 42" —
 * and a vulcanised drysuit boot is two to three fin sizes bigger than the foot
 * inside it. Packed to the stated number, the crew hands over a pair that will
 * not go on: the diver sits on the bench, the boat waits, and the fix is
 * somebody's spare pair. These tests refuse it.
 */
describe("fins for a diver in a drysuit", () => {
  const drysuitDiver = {
    ...fullFit,
    rentsDrysuit: true,
    drysuitSize: "ML",
    rentsWetsuit: false,
    rentsMaskFins: true,
    finSize: "US 9",
  };

  it("marks the fin line rather than packing the stated shoe size", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
    });
    // The size stays: it is where the packer sizes up from, not what they pull.
    expect(lineFor(checklist, "mask_fins", "US 9")).toMatchObject({
      count: 1,
      drysuitFinFit: true,
      divers: ["Dry Dana"],
    });
    // Both groupings are built from the same pieces, so neither can read the
    // shoe size as the pair to hand over while the other says otherwise.
    const fins = checklist.diverLines[0]?.items.find((piece) => piece.kind === "mask_fins");
    expect(fins).toMatchObject({ size: "US 9", drysuitFinFit: true });
  });

  it("leaves a wetsuit diver's fins as a plain size to pull", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Wet Wanda",
          fit: { ...drysuitDiver, rentsDrysuit: false, drysuitSize: null, rentsWetsuit: true },
        }),
      ],
      plannedDives: 1,
    });
    expect(lineFor(checklist, "mask_fins", "US 9")).toMatchObject({
      count: 1,
      drysuitFinFit: false,
    });
  });

  it("keeps the two size-9 divers on separate lines", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver }),
        diver({
          bookingId: "b2",
          fullName: "Wet Wanda",
          fit: { ...drysuitDiver, rentsDrysuit: false, drysuitSize: null, rentsWetsuit: true },
        }),
      ],
      plannedDives: 1,
    });
    // One string, two pairs off the rack. Collapsed into a row of two, the
    // packer pulls two bare-foot pairs and one of them goes back.
    const fins = checklist.lines.filter((line) => line.kind === "mask_fins");
    expect(fins.map((line) => [line.drysuitFinFit, line.count, line.divers])).toEqual([
      [false, 1, ["Wet Wanda"]],
      [true, 1, ["Dry Dana"]],
    ]);
  });

  it("marks the line even when nobody stated a fin size at all", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Dry Dana", fit: { ...drysuitDiver, finSize: null } }),
      ],
      plannedDives: 1,
    });
    // The suit is the reason, not the missing answer.
    expect(lineFor(checklist, "mask_fins", null)).toMatchObject({ drysuitFinFit: true });
  });

  it("leaves a flagged diver on fit-at-check-in, which is the same job in person", () => {
    const flaggedAt = new Date("2026-09-01T08:00:00Z");
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Dry Dana",
          fit: { ...drysuitDiver, needsStaffFitAt: flaggedAt },
        }),
      ],
      plannedDives: 1,
      now: flaggedAt,
    });
    expect(lineFor(checklist, "mask_fins", null)).toMatchObject({
      fitAtCheckIn: true,
      drysuitFinFit: false,
    });
  });

  it("says it on the roll call and the offline manifest too", () => {
    // `rentalFitLine` is what the rail reads (DiverRollCall, OfflineManifestView),
    // and the rail is the last place a bare-foot number should read like the
    // pair to hand over.
    const line = rentalFitLine(drysuitDiver);
    const items = line.state === "rents" ? line.items : [];
    expect(items.find((item) => item.kind === "mask_fins")).toEqual({
      kind: "mask_fins",
      size: "US 9",
      drysuitFinFit: true,
    });
    // Absent, not false, on every other piece: a reader that has never heard
    // of the flag reads the same line it always did.
    expect(items.find((item) => item.kind === "bcd")).toEqual({ kind: "bcd", size: "M" });
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
    expect(checklist.diversWithIncompleteFit).toEqual([
      { fullName: "Priya Sharma", personId: "b1", state: "not_recorded", missing: [] },
    ]);
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
    // ...and he is not miscounted as a diver with a gap in their fit: every
    // size he takes from the shop is on file, which is a different fact from
    // the shop being out of one of them.
    expect(checklist.diversWithIncompleteFit).toEqual([]);
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

  it("reads a row that carries only the diver's note as nobody asked", () => {
    // `rental_fit_profiles` gained a second writer in issue 627 — the diver's
    // free-text note, saved on its own. Every `rents_*` column defaults to
    // true, so without `fitStatedAt` a diver who typed one sentence and nothing
    // else would arrive on the packing list renting a full kit in no size.
    expect(rentalFitLine({ ...fullFit, fitStatedAt: null })).toEqual({ state: "not_recorded" });
  });

  it("keeps a hand-built fit on the list — only an explicit null means note-only", () => {
    // The offline manifest snapshot and these tests build a `RentalFit` by
    // hand; an absent `fitStatedAt` must not silently drop a real diver.
    expect(rentalFitLine(fullFit)).toMatchObject({ state: "rents" });
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

/**
 * **A fit is counted per item, not per row** (glossary — *Complete rental fit*).
 *
 * The prep list used to ask only whether a fit row existed, which excused the
 * commoner gap: a diver who ticked BCD, wetsuit and weights and supplied one
 * shoe size had a row, so the packing list called them done and the packer
 * found out at the rack. These pin the widened meaning, in both directions.
 */
describe("divers with an incomplete fit", () => {
  it("names a diver who rents a piece with no size, even though a fit row exists", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        // Rents everything, and the only size anybody typed is a fin size.
        diver({
          bookingId: "b1",
          fullName: "Partial Pat",
          fit: { ...fullFit, bcdSize: null, wetsuitSize: null, weightPreference: null },
        }),
      ],
      plannedDives: 2,
    });
    expect(checklist.diversWithIncompleteFit).toEqual([
      {
        fullName: "Partial Pat",
        personId: "b1",
        state: "incomplete",
        missing: ["bcd", "wetsuit", "weights"],
      },
    ]);
  });

  it("still packs every piece a partially-fitted diver rents", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Partial Pat", fit: { ...fullFit, bcdSize: null } }),
      ],
      plannedDives: 1,
    });
    // The sizes they did give are real, and dropping their pieces to punish
    // the gap would send the boat out a BCD short.
    expect(checklist.lines.map((line) => line.kind)).toEqual([
      "bcd",
      "regulator",
      "wetsuit",
      "boots",
      "mask_fins",
      "weights",
    ]);
    expect(lineFor(checklist, "bcd", null)).toMatchObject({ count: 1, divers: ["Partial Pat"] });
    expect(checklist.tanks.total).toBe(1);
  });

  it("leaves a fully-sized diver out of it", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Complete Cleo" })],
      plannedDives: 1,
    });
    expect(checklist.diversWithIncompleteFit).toEqual([]);
  });

  it("keeps 'nobody asked' apart from 'asked and half blank' — the fixes differ", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Unasked Uma", fit: null }),
        diver({ bookingId: "b2", fullName: "Partial Pat", fit: { ...fullFit, bcdSize: null } }),
      ],
      plannedDives: 1,
    });
    expect(checklist.diversWithIncompleteFit.map((row) => [row.fullName, row.state])).toEqual([
      ["Unasked Uma", "not_recorded"],
      ["Partial Pat", "incomplete"],
    ]);
    // "Nothing on file" names no pieces: the answer is "all of it", and listing
    // five items would say less than the state already does.
    expect(checklist.diversWithIncompleteFit[0]?.missing).toEqual([]);
  });

  it("never asks for a size the one-size gear doesn't have", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Reg Only Rae",
          fit: {
            ...fullFit,
            rentsBcd: false,
            rentsWetsuit: false,
            rentsMaskFins: false,
            rentsWeights: false,
            rentsDiveComputer: true,
            rentsGopro: true,
            rentsDrysuit: false,
            rentsHoodGloves: false,
            rentsTorch: false,
            rentsSmb: false,
            bcdSize: null,
            wetsuitSize: null,
            bootSize: null,
            finSize: null,
            weightPreference: null,
          },
        }),
      ],
      plannedDives: 1,
    });
    expect(checklist.diversWithIncompleteFit).toEqual([]);
  });

  it("stops asking once the shop drops that item from its catalog", () => {
    const divers = [
      diver({ bookingId: "b1", fullName: "Partial Pat", fit: { ...fullFit, bcdSize: null } }),
    ];
    expect(
      buildDivePrepChecklist({ divers, plannedDives: 1, offeredKinds: ["bcd", "wetsuit"] })
        .diversWithIncompleteFit,
    ).toMatchObject([{ state: "incomplete", missing: ["bcd"] }]);
    // Same fit, a shop that no longer rents BCDs: no size to hand over, so no
    // size to chase.
    expect(
      buildDivePrepChecklist({ divers, plannedDives: 1, offeredKinds: ["wetsuit", "mask_fins"] })
        .diversWithIncompleteFit,
    ).toEqual([]);
  });
});

/**
 * **A shop that drops an item does not get to change what the rest of the list
 * says.**
 *
 * `rents_drysuit` survives the shop unticking drysuit in its catalog, which is
 * correct (issue #1755): the diver stated it, nobody retracted it, and a
 * catalog edit is not the diver speaking. What the read side did with that
 * surviving flag was the unfinished half — it still suppressed the weights
 * number, still sized fins up over a boot that was not coming, and still raised
 * the card advisory, all three of them derived from a flag the shop's own
 * catalog contradicted. None of the three is about the drysuit *piece*; each is
 * a claim about what else changes because a rental suit is going out.
 *
 * The piece itself stays, marked. A silent filter at the read would be the same
 * failure the writer refuses, one layer down.
 */
describe("a piece the shop stopped renting", () => {
  const drysuitDiver: RentalFit = {
    ...fullFit,
    rentsDrysuit: true,
    drysuitSize: "ML",
    rentsWeights: true,
    weightPreference: "12 lb with 3 mm suit",
    rentsMaskFins: true,
    finSize: "US 9",
  };
  /** Everything the fit above asks for, except the suit. */
  const noDrysuits = ["bcd", "regulator", "wetsuit", "mask_fins", "weights"];
  const withDrysuits = [...noDrysuits, "drysuit"];

  it("keeps the drysuit on the list and says the shop no longer rents it", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
      offeredKinds: noDrysuits,
    });
    // Still there, still sized: the size is what the conversation with the
    // diver is about, and a line that vanished would tell the packer nothing
    // while the fit behind it still records a suit.
    expect(lineFor(checklist, "drysuit", "ML")).toMatchObject({
      count: 1,
      notOffered: true,
      divers: ["Dry Dana"],
    });
    const pieces = checklist.diverLines[0]?.items ?? [];
    expect(pieces.find((piece) => piece.kind === "drysuit")).toMatchObject({
      size: "ML",
      notOffered: true,
    });
  });

  it("gives the diver their stated weighting back", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
      offeredKinds: noDrysuits,
    });
    // No suit off this wall, so nothing is adding two to four kilos and there
    // is no correction to make. Withholding the most safety-relevant number in
    // the fit over a suit nobody is handing over is the expensive direction:
    // under-weighted is the diver who cannot hold a safety stop.
    expect(lineFor(checklist, "weights", "12 lb with 3 mm suit")).toMatchObject({
      count: 1,
      drysuitWeightCheck: false,
      divers: ["Dry Dana"],
    });
    expect(checklist.lines.some((line) => line.drysuitWeightCheck)).toBe(false);
  });

  it("gives the diver ordinary fin sizing back", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
      offeredKinds: noDrysuits,
    });
    // "Size up over the boot" packs two to three sizes too big with no boot in
    // the picture, and a fin that loose comes off on a drift dive.
    expect(lineFor(checklist, "mask_fins", "US 9")).toMatchObject({
      count: 1,
      drysuitFinFit: false,
      notOffered: false,
    });
    expect(checklist.lines.some((line) => line.drysuitFinFit)).toBe(false);
  });

  it("says the same thing on the roll call and the offline manifest", () => {
    // `rentalFitLine` is what the rail reads, and handed the same catalog it
    // cannot contradict the packing list.
    const line = rentalFitLine(drysuitDiver, noDrysuits);
    const items = line.state === "rents" ? line.items : [];
    expect(items.find((item) => item.kind === "weights")).toEqual({
      kind: "weights",
      size: "12 lb with 3 mm suit",
    });
    expect(items.find((item) => item.kind === "mask_fins")).toEqual({
      kind: "mask_fins",
      size: "US 9",
    });
  });

  it("leaves all three alone while the shop still rents drysuits", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
      offeredKinds: withDrysuits,
    });
    // The mirror case: the catalog is the discriminator, never the flag alone.
    expect(lineFor(checklist, "weights", null)).toMatchObject({ drysuitWeightCheck: true });
    expect(lineFor(checklist, "mask_fins", "US 9")).toMatchObject({ drysuitFinFit: true });
    expect(lineFor(checklist, "drysuit", "ML")).toMatchObject({ notOffered: false });
  });

  it("leaves all three alone when no catalog was handed over", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Dry Dana", fit: drysuitDiver })],
      plannedDives: 1,
    });
    // Over-including is the safe direction for a packing list, and it is what
    // `rentalFitCompleteness` already does with an absent catalog.
    expect(lineFor(checklist, "weights", null)).toMatchObject({ drysuitWeightCheck: true });
    expect(lineFor(checklist, "drysuit", "ML")).toMatchObject({ notOffered: false });
  });

  it("marks a dropped piece that never had a size to show", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Torch Tomas",
          fit: { ...fullFit, rentsTorch: true },
        }),
      ],
      plannedDives: 1,
      offeredKinds: noDrysuits,
    });
    // A torch has no size to carry, so the mark is the only thing the line can
    // say — and without it the row would read as an ordinary piece to pull.
    expect(lineFor(checklist, "torch", null)).toMatchObject({ count: 1, notOffered: true });
    expect(lineFor(checklist, "bcd", "M")).toMatchObject({ notOffered: false });
  });

  it("reads boots off the wetsuit, which is the only entry that exists", () => {
    const checklist = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Wet Wanda" })],
      plannedDives: 1,
      offeredKinds: withDrysuits,
    });
    // Boots are not a catalog entry of their own — nothing ticks them, they
    // ride along with the suit — so asking the catalog about `boots` directly
    // would read every shop on earth as having dropped them.
    expect(lineFor(checklist, "boots", "9")).toMatchObject({ notOffered: false });
    // And a shop that drops the suit drops its boots with it.
    const dropped = buildDivePrepChecklist({
      divers: [diver({ bookingId: "b1", fullName: "Wet Wanda" })],
      plannedDives: 1,
      offeredKinds: ["bcd", "regulator", "mask_fins", "weights"],
    });
    expect(lineFor(dropped, "boots", "9")).toMatchObject({ notOffered: true });
    expect(lineFor(dropped, "wetsuit", "5mm M")).toMatchObject({ notOffered: true });
  });
});

describe("the same packing list grouped by diver", () => {
  it("regroups exactly the pieces the by-item rows carry, one row per diver", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Priya Sharma" }),
        diver({
          bookingId: "b2",
          fullName: "Ana Ruiz",
          fit: { ...fullFit, bcdSize: "L", wetsuitSize: "5mm L", bootSize: "11", finSize: "L" },
        }),
      ],
      plannedDives: 1,
    });
    // Two groupings, one set of pieces: the totals have to agree, or the boat
    // is being told two different things about one fit.
    const piecesByItem = checklist.lines.reduce((sum, line) => sum + line.count, 0);
    const piecesByDiver = checklist.diverLines.reduce((sum, row) => sum + row.items.length, 0);
    expect(piecesByDiver).toBe(piecesByItem);
    // Alphabetical, so it is a roster to walk rather than query order.
    expect(checklist.diverLines.map((row) => row.fullName)).toEqual(["Ana Ruiz", "Priya Sharma"]);
    expect(checklist.diverLines[0]).toMatchObject({
      bookingId: "b2",
      state: "rents",
      // The same fixed item order the by-item rows read in — and boots ride
      // along with the suit here too.
      items: [
        { kind: "bcd", size: "L", fitAtCheckIn: false },
        { kind: "regulator", size: null, fitAtCheckIn: false },
        { kind: "wetsuit", size: "5mm L", fitAtCheckIn: false },
        { kind: "boots", size: "11", fitAtCheckIn: false },
        { kind: "mask_fins", size: "L", fitAtCheckIn: false },
        { kind: "weights", size: "6 kg", fitAtCheckIn: false },
      ],
    });
  });

  it("gives a diver with nothing to pull a row, and says which nothing it is", () => {
    const ownKit: RentalFit = {
      ...fullFit,
      rentsBcd: false,
      rentsRegulator: false,
      rentsWetsuit: false,
      rentsMaskFins: false,
      rentsWeights: false,
    };
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Own Kit Omar", fit: ownKit }),
        diver({ bookingId: "b2", fullName: "Unasked Uma", fit: null }),
      ],
      plannedDives: 1,
    });
    // Neither has a by-item row to appear in, and a roster you cannot walk to
    // the end of is not a roster.
    expect(checklist.lines).toEqual([]);
    expect(checklist.diverLines.map((row) => [row.fullName, row.state, row.items.length])).toEqual([
      ["Own Kit Omar", "own_kit", 0],
      ["Unasked Uma", "not_recorded", 0],
    ]);
  });

  it("blanks a flagged diver's sizes in this grouping too, keeping their pieces", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({
          bookingId: "b1",
          fullName: "Sam Whitfield",
          fit: { ...fullFit, bcdSize: "XL", needsStaffFitAt: new Date("2026-07-20T12:00:00Z") },
        }),
      ],
      plannedDives: 1,
      now: new Date("2026-07-21T12:00:00Z"),
    });
    const row = checklist.diverLines[0];
    // The count the packer loads from is intact...
    expect(row?.items.map((piece) => piece.kind)).toEqual([
      "bcd",
      "regulator",
      "wetsuit",
      "boots",
      "mask_fins",
      "weights",
    ]);
    // ...and no piece the flag touches names a size the shop is short of.
    expect(row?.items.find((piece) => piece.kind === "bcd")).toMatchObject({
      size: null,
      fitAtCheckIn: true,
    });
    expect(
      row?.items.filter((piece) => piece.fitAtCheckIn).every((piece) => piece.size === null),
    ).toBe(true);
    // Weights are never blanked: lead is bulk stock, and usual weighting is the
    // most safety-relevant number in the fit.
    expect(row?.items.find((piece) => piece.kind === "weights")).toMatchObject({
      size: "6 kg",
      fitAtCheckIn: false,
    });
  });
});

describe("the packing-list grouping in the URL", () => {
  it("takes only the two groupings the page renders", () => {
    expect(isPrepGrouping("item")).toBe(true);
    expect(isPrepGrouping("diver")).toBe(true);
    // Anything else is a stale or hand-typed query string; the call site reads
    // it as the by-item default rather than rendering nothing.
    expect(isPrepGrouping("divers")).toBe(false);
    expect(isPrepGrouping("Item")).toBe(false);
    expect(isPrepGrouping(undefined)).toBe(false);
  });
});

describe("buildHotelPickupList", () => {
  it("returns an empty list when no divers have lodging/hotel pickups requested", () => {
    const divers = [
      diver({ bookingId: "b1", fullName: "Alice" }),
      diver({ bookingId: "b2", fullName: "Bob", hotelPickupLocation: null }),
      diver({ bookingId: "b3", fullName: "Charlie", hotelPickupLocation: "   " }),
    ];
    expect(buildHotelPickupList(divers)).toEqual([]);
  });

  it("extracts and sorts hotel pickups by scheduled time then hotel location", () => {
    const divers = [
      diver({
        bookingId: "b1",
        fullName: "Late Diver",
        hotelPickupLocation: "Hilton Resort",
        pickupTime: "07:45",
      }),
      diver({
        bookingId: "b2",
        fullName: "Untimed Diver",
        hotelPickupLocation: "Bay View Hotel",
        pickupTime: null,
      }),
      diver({
        bookingId: "b3",
        fullName: "Early Diver",
        hotelPickupLocation: "Sunset Palms",
        pickupTime: "07:15",
      }),
      diver({
        bookingId: "b4",
        fullName: "Mid Diver",
        hotelPickupLocation: "Aqua Lodge",
        pickupTime: "07:30",
      }),
    ];

    const result = buildHotelPickupList(divers);
    expect(result).toEqual([
      {
        bookingId: "b3",
        diverName: "Early Diver",
        hotelPickupLocation: "Sunset Palms",
        pickupTime: "07:15",
      },
      {
        bookingId: "b4",
        diverName: "Mid Diver",
        hotelPickupLocation: "Aqua Lodge",
        pickupTime: "07:30",
      },
      {
        bookingId: "b1",
        diverName: "Late Diver",
        hotelPickupLocation: "Hilton Resort",
        pickupTime: "07:45",
      },
      {
        bookingId: "b2",
        diverName: "Untimed Diver",
        hotelPickupLocation: "Bay View Hotel",
        pickupTime: null,
      },
    ]);
  });
});
