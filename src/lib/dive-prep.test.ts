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
