import { describe, expect, it } from "vitest";
import { boatWorkItems } from "./boat-work";

const now = new Date("2026-10-13T12:00:00Z");
const tonight = new Date("2026-10-14T03:30:00Z");
const nextWeek = new Date("2026-10-20T11:00:00Z");
const none = { missingSize: 0, kitUnasked: 0, ungatedNitrox: 0, missingContact: 0, openOrders: 0 };

describe("boatWorkItems", () => {
  it("says nothing for a boat with no work", () => {
    expect(boatWorkItems(none, { startsAt: tonight, now })).toEqual([]);
  });

  it("lists every job in one order, with its count", () => {
    expect(
      boatWorkItems(
        { missingSize: 1, kitUnasked: 3, ungatedNitrox: 1, missingContact: 3, openOrders: 2 },
        { startsAt: tonight, now },
      ),
    ).toEqual([
      { code: "missing_sizes", count: 4, sizes: { missing: 1, unasked: 3 } },
      { code: "ungated_nitrox", count: 1 },
      { code: "missing_contact", count: 3 },
      { code: "open_orders", count: 2 },
    ]);
  });

  it("asks about emergency contacts only once the boat is within three days", () => {
    const counts = { ...none, missingContact: 3 };
    expect(boatWorkItems(counts, { startsAt: nextWeek, now })).toEqual([]);
    expect(boatWorkItems(counts, { startsAt: tonight, now })).toEqual([
      { code: "missing_contact", count: 3 },
    ]);
  });

  it("keeps money owed on a boat a week out: an invoice is chased early", () => {
    expect(boatWorkItems({ ...none, openOrders: 1 }, { startsAt: nextWeek, now })).toEqual([
      { code: "open_orders", count: 1 },
    ]);
  });

  // Fourth review, item 36: "4 people missing rental sizes" was one diver with
  // a blank size and three nobody had asked about kit, two different jobs.
  it("keeps the two halves of the sizes job apart, and says either alone", () => {
    expect(boatWorkItems({ ...none, kitUnasked: 2 }, { startsAt: tonight, now })).toEqual([
      { code: "missing_sizes", count: 2, sizes: { missing: 0, unasked: 2 } },
    ]);
  });
});
