import { describe, expect, it } from "vitest";
import { buildDivePrepChecklist, type PrepDiver, type RentalFit } from "./dive-prep";

const flaggedAt = new Date("2026-09-01T08:00:00Z");

/** A BCD to fit in person: the size the shop could not fill is blanked on the line. */
const flaggedFit: RentalFit = {
  rentsBcd: true,
  rentsRegulator: false,
  rentsWetsuit: false,
  rentsMask: false,
  rentsFins: false,
  rentsWeights: false,
  rentsDiveComputer: false,
  rentsGopro: false,
  rentsDrysuit: false,
  rentsHood: false,
  rentsGloves: false,
  rentsTorch: false,
  rentsSmb: false,
  bcdSize: "M",
  wetsuitSize: null,
  drysuitSize: null,
  hoodSize: null,
  gloveSize: null,
  bootSize: null,
  finSize: null,
  weightPreference: null,
  divesDry: false,
  needsStaffFitAt: flaggedAt,
};

const seat = (bookingId: string): PrepDiver => ({
  bookingId,
  personId: `person-${bookingId}`,
  fullName: "Carlos García",
  fit: flaggedFit,
  wantsNitrox: false,
  hasVerifiedNitroxCard: false,
  lastDivedBand: null,
});

/** Two divers who share a name are two seats on the packing list (issue #3049). */
describe("buildDivePrepChecklist with namesakes", () => {
  it("keeps two namesakes on one line as two seats, each with their own booking", () => {
    const checklist = buildDivePrepChecklist({
      divers: [seat("b2"), seat("b1")],
      plannedDives: 1,
      now: flaggedAt,
    });
    expect(checklist.lines.find((line) => line.kind === "bcd")).toMatchObject({
      count: 2,
      fitAtCheckIn: true,
      divers: [
        { bookingId: "b1", fullName: "Carlos García" },
        { bookingId: "b2", fullName: "Carlos García" },
      ],
    });
  });
});
