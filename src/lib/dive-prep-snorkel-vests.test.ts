import { describe, expect, it } from "vitest";
import { buildDivePrepChecklist, type PrepDiver } from "./dive-prep";

/** A seat with no fit on file: a vest is the boat's, so it never waits on one. */
function diver(
  overrides: Partial<PrepDiver> & Pick<PrepDiver, "bookingId" | "fullName">,
): PrepDiver {
  return {
    personId: overrides.bookingId,
    fit: null,
    wantsNitrox: false,
    hasVerifiedNitroxCard: false,
    lastDivedBand: null,
    ...overrides,
  };
}

/**
 * Issue #2213. One snorkel vest per snorkeler seat, free and always on: it
 * does not wait on a fit, the catalog, or the shop's own kit. Divers wear a
 * BCD and riders stay aboard, so neither is counted.
 */
describe("snorkel vests on the packing list", () => {
  it("counts one vest per snorkeler on a mixed boat, none for divers or riders", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Dee Diver" }),
        diver({ bookingId: "b2", fullName: "Dan Diver", fit: null }),
        diver({ bookingId: "b3", fullName: "Sol Snorkel", participantType: "snorkeler" }),
        // A snorkeler with no fit on file, and one in their own kit, still
        // take a vest: it is the boat's, not a rental.
        diver({
          bookingId: "b4",
          fullName: "Sam Snorkel",
          participantType: "snorkeler",
          fit: null,
        }),
        diver({
          bookingId: "b5",
          fullName: "Sue Snorkel",
          participantType: "snorkeler",
          identityHeld: true,
        }),
        diver({ bookingId: "b6", fullName: "Ray Rider", participantType: "rider" }),
      ],
      plannedDives: 2,
      offeredKinds: ["bcd"],
    });
    expect(checklist.snorkelVests).toBe(3);
    expect(checklist.diverCount).toBe(2);
  });

  it("counts none on a boat with no snorkelers", () => {
    const checklist = buildDivePrepChecklist({
      divers: [
        diver({ bookingId: "b1", fullName: "Dee Diver" }),
        diver({ bookingId: "b2", fullName: "Ray Rider", participantType: "rider" }),
      ],
      plannedDives: 1,
    });
    expect(checklist.snorkelVests).toBe(0);
  });
});
