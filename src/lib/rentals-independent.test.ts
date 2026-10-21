import { describe, expect, it } from "vitest";
import { type RentalFit, rentalFitLine } from "./dive-prep";
import { NOTHING_RENTED, rentalFitCompleteness, rentalFlagsFromKinds } from "./rentals";

const fit: RentalFit = {
  ...NOTHING_RENTED,
  bcdSize: null,
  wetsuitSize: null,
  bootSize: null,
  finSize: null,
  drysuitSize: null,
  hoodSize: null,
  gloveSize: null,
  weightPreference: null,
  divesDry: false,
  fitStatedAt: new Date("2026-10-19T12:00:00Z"),
};

describe("independent surface rental demand", () => {
  it.each([
    { mask: true, fins: false, kinds: ["mask"] },
    { mask: false, fins: true, kinds: ["fins"] },
    { mask: true, fins: true, kinds: ["mask", "fins"] },
    { mask: false, fins: false, kinds: [] },
  ])("packs exactly the selected pieces: $kinds", ({ mask, fins, kinds }) => {
    const answer = { ...fit, rentsMask: mask, rentsFins: fins };
    const line = rentalFitLine(answer, ["mask", "fins"]);
    expect(line.state === "rents" ? line.items.map((item) => item.kind) : []).toEqual(kinds);
    expect(rentalFitCompleteness(answer)).toEqual(
      fins ? { state: "incomplete", missing: ["fins"] } : { state: "complete" },
    );
  });

  it("records checkout mask and fins picks independently", () => {
    expect(rentalFlagsFromKinds(["mask"])).toMatchObject({ rentsMask: true, rentsFins: false });
    expect(rentalFlagsFromKinds(["fins"])).toMatchObject({ rentsMask: false, rentsFins: true });
  });
});
