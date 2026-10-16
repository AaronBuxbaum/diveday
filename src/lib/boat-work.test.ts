import { describe, expect, it } from "vitest";
import { boatWorkItems, seatUngatedNitrox } from "./boat-work";

const now = new Date("2026-10-13T12:00:00Z");
const tonight = new Date("2026-10-14T03:30:00Z");
const nextWeek = new Date("2026-10-20T11:00:00Z");
const none = { missingFit: 0, ungatedNitrox: 0, missingContact: 0, openOrders: 0 };

describe("boatWorkItems", () => {
  it("says nothing for a boat with no work", () => {
    expect(boatWorkItems(none, { startsAt: tonight, now })).toEqual([]);
  });

  it("lists every job in one order, with its count", () => {
    expect(
      boatWorkItems(
        { missingFit: 4, ungatedNitrox: 1, missingContact: 3, openOrders: 2 },
        { startsAt: tonight, now },
      ),
    ).toEqual([
      { code: "missing_sizes", count: 4, tone: "work" },
      { code: "ungated_nitrox", count: 1, tone: "warning" },
      { code: "missing_contact", count: 3, tone: "work" },
      { code: "open_orders", count: 2, tone: "work" },
    ]);
  });

  it("asks about emergency contacts only once the boat is within three days", () => {
    const counts = { ...none, missingContact: 3 };
    expect(boatWorkItems(counts, { startsAt: nextWeek, now })).toEqual([]);
    expect(boatWorkItems(counts, { startsAt: tonight, now })).toEqual([
      { code: "missing_contact", count: 3, tone: "work" },
    ]);
  });

  it("keeps money owed on a boat a week out: an invoice is chased early", () => {
    expect(boatWorkItems({ ...none, openOrders: 1 }, { startsAt: nextWeek, now })).toEqual([
      { code: "open_orders", count: 1, tone: "work" },
    ]);
  });

  it("reads ungated nitrox as a warning on every boat, near or far, and nothing else", () => {
    // A diver who planned for nitrox and breathes air has shorter
    // no-decompression limits than planned (issue #2549), matching Today's
    // nitrox_gate chip.
    for (const startsAt of [tonight, nextWeek]) {
      const items = boatWorkItems(
        { missingFit: 1, ungatedNitrox: 2, missingContact: 1, openOrders: 1 },
        { startsAt, now },
      );
      expect(items.filter((item) => item.tone === "warning").map((item) => item.code)).toEqual([
        "ungated_nitrox",
      ]);
    }
  });
});

describe("seatUngatedNitrox", () => {
  const asked = { wantsNitrox: true, hasFillCard: false };

  it("counts a diver who wants nitrox with no card that authorizes a fill", () => {
    expect(seatUngatedNitrox({ participantType: "diver", ...asked })).toBe(true);
    expect(seatUngatedNitrox({ participantType: null, ...asked })).toBe(true);
    expect(seatUngatedNitrox({ participantType: undefined, ...asked })).toBe(true);
  });

  it("never counts a snorkeler or a rider, whatever their flag says", () => {
    expect(seatUngatedNitrox({ participantType: "snorkeler", ...asked })).toBe(false);
    expect(seatUngatedNitrox({ participantType: "rider", ...asked })).toBe(false);
  });

  it("does not count a diver with a card, or one who never asked", () => {
    expect(seatUngatedNitrox({ participantType: "diver", ...asked, hasFillCard: true })).toBe(
      false,
    );
    expect(seatUngatedNitrox({ participantType: "diver", ...asked, wantsNitrox: false })).toBe(
      false,
    );
  });
});
