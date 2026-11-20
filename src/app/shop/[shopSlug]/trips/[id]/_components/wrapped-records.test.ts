import { describe, expect, it } from "vitest";
import { wrappedRecords } from "./wrapped-records";

const reef = { id: "reef" };
const wreck = { id: "wreck" };
const dives = [
  { diveNumber: 2, recorded: undefined, planned: wreck },
  { diveNumber: 1, recorded: { actualSite: reef }, planned: wreck },
];
const turtle = { diveSiteId: "wreck", speciesSlug: "green-turtle", customName: null };

describe("wrappedRecords", () => {
  it("counts each species once and opens the first dive whose Roll call holds them", () => {
    const records = wrappedRecords({
      sightingsOn: true,
      sightings: [turtle, { ...turtle, diveSiteId: "wreck" }, { ...turtle, speciesSlug: "eel" }],
      dives,
      lostFoundOn: true,
      lostItems: [{}, {}],
    });
    // Dive 1 was recorded at the reef, so the wreck's taps are dive 2's.
    expect(records).toEqual({ seen: { species: 2, dive: 2 }, leftAboard: { count: 2 } });
  });

  it("is no row for a record with nothing in it, or a feature the shop has off", () => {
    expect(
      wrappedRecords({ sightingsOn: true, sightings: [], dives, lostFoundOn: true, lostItems: [] }),
    ).toEqual({ seen: null, leftAboard: null });
    expect(
      wrappedRecords({
        sightingsOn: false,
        sightings: [turtle],
        dives,
        lostFoundOn: false,
        lostItems: [{}],
      }),
    ).toEqual({ seen: null, leftAboard: null });
  });

  it("still says what was seen when no dive places the site", () => {
    expect(
      wrappedRecords({
        sightingsOn: true,
        sightings: [{ ...turtle, diveSiteId: "elsewhere" }],
        dives,
        lostFoundOn: true,
        lostItems: [],
      }).seen,
    ).toEqual({ species: 1, dive: null });
  });
});
