import { describe, expect, it } from "vitest";
import { hasTripDiveContent, summarizeTripDiveSites, tripDiveDraftsFromForm } from "./trip-dives";

const site = (id: string, name: string) => ({ id, name });

describe("summarizeTripDiveSites", () => {
  it("lists two sites of a two-site day in dive order", () => {
    expect(
      summarizeTripDiveSites([
        { diveNumber: 1, site: site("a", "Benwood Wreck") },
        { diveNumber: 2, site: site("b", "Elbow Reef") },
      ]),
    ).toEqual({
      sites: [site("a", "Benwood Wreck"), site("b", "Elbow Reef")],
      undecidedDives: 0,
    });
  });

  it("counts one site, not two, when the same site is dived twice", () => {
    expect(
      summarizeTripDiveSites([
        { diveNumber: 1, site: site("a", "French Reef") },
        { diveNumber: 2, site: site("a", "French Reef") },
      ]),
    ).toEqual({ sites: [site("a", "French Reef")], undecidedDives: 0 });
  });

  it("reports the undecided tank of a two-tank day that has one site so far", () => {
    expect(
      summarizeTripDiveSites([
        { diveNumber: 1, site: site("a", "Benwood Wreck") },
        { diveNumber: 2, site: null },
      ]),
    ).toEqual({ sites: [site("a", "Benwood Wreck")], undecidedDives: 1 });
  });

  it("still finds the site when the *first* tank is the undecided one", () => {
    // The bug this whole helper exists for: `trips.dive_site_id` is dive one's
    // site, so a day planned second-tank-first named no site anywhere.
    expect(
      summarizeTripDiveSites([
        { diveNumber: 1, site: null },
        { diveNumber: 2, site: site("b", "Spiegel Grove") },
      ]),
    ).toEqual({ sites: [site("b", "Spiegel Grove")], undecidedDives: 1 });
  });

  it("orders by dive number even when the rows arrive shuffled", () => {
    expect(
      summarizeTripDiveSites([
        { diveNumber: 3, site: site("c", "Pickles Reef") },
        { diveNumber: 1, site: site("a", "Molasses Reef") },
        { diveNumber: 2, site: null },
      ]),
    ).toEqual({
      sites: [site("a", "Molasses Reef"), site("c", "Pickles Reef")],
      undecidedDives: 1,
    });
  });

  it("says nothing rather than guessing when no tank has a site yet", () => {
    expect(
      summarizeTripDiveSites([
        { diveNumber: 1, site: null },
        { diveNumber: 2, site: null },
      ]),
    ).toEqual({ sites: [], undecidedDives: 2 });
  });

  it("is empty for a trip with no dive rows at all", () => {
    expect(summarizeTripDiveSites([])).toEqual({ sites: [], undecidedDives: 0 });
  });

  it("does not mutate the caller's array", () => {
    const dives = [
      { diveNumber: 2, site: site("b", "Elbow Reef") },
      { diveNumber: 1, site: site("a", "Benwood Wreck") },
    ];
    summarizeTripDiveSites(dives);
    expect(dives[0]?.diveNumber).toBe(2);
  });
});

describe("tripDiveDraftsFromForm", () => {
  it("reads one draft per planned dive, blanking empty fields", () => {
    const form = new FormData();
    form.set("dive-1-title", " Benwood Wreck ");
    form.set("dive-1-siteId", "site-a");
    form.set("dive-1-description", "Bow to stern.");
    form.set("dive-1-travelMinutes", "15");
    form.set("dive-2-title", "");
    form.set("dive-2-siteId", "");
    expect(tripDiveDraftsFromForm(form, 2)).toEqual([
      {
        title: "Benwood Wreck",
        diveSiteId: "site-a",
        description: "Bow to stern.",
        travelMinutes: 15,
      },
      { title: null, diveSiteId: null, description: null, travelMinutes: null },
    ]);
  });

  it("keeps a stated zero leg, which is a different answer from an empty box", () => {
    // Same site twice, or a walk-in entry — a real answer, not "unset".
    const form = new FormData();
    form.set("dive-1-travelMinutes", "0");
    expect(tripDiveDraftsFromForm(form, 1)[0]?.travelMinutes).toBe(0);
  });

  it("drops a leg outside the bounds the box enforces rather than losing the edit", () => {
    // The table's CHECK would refuse these, so they never get handed down; the
    // leg falls back to the shop's own ride out instead of 500ing a save.
    const form = new FormData();
    for (const [dive, value] of [
      [1, "-5"],
      [2, "9999"],
      [3, "12.5"],
      [4, "soon"],
    ] as const) {
      form.set(`dive-${dive}-travelMinutes`, value);
    }
    expect(tripDiveDraftsFromForm(form, 4).map((draft) => draft.travelMinutes)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("hasTripDiveContent", () => {
  const blank = { title: null, diveSiteId: null, description: null, travelMinutes: null };

  it("reads a form posted with the panel closed as empty", () => {
    // Every field blank means the cards were never on screen. Writing those
    // over a departure would erase the quick row's own dive-site select.
    expect(hasTripDiveContent([blank, blank])).toBe(false);
  });

  it("counts a stated leg on its own as content", () => {
    // The regression: a staffer whose only per-dive edit was "10 minutes out,
    // then 150 across to the wall" had the whole departure's timeline thrown
    // away, and the diver read the shop's default ride instead.
    expect(
      hasTripDiveContent([
        { ...blank, travelMinutes: 10 },
        { ...blank, travelMinutes: 150 },
      ]),
    ).toBe(true);
  });

  it("counts a zero-minute leg, which is a statement and not an absence", () => {
    // The same site twice, or a shore entry.
    expect(hasTripDiveContent([{ ...blank, travelMinutes: 0 }])).toBe(true);
  });

  it("still counts the three fields it always did", () => {
    expect(hasTripDiveContent([{ ...blank, title: "Wall" }])).toBe(true);
    expect(hasTripDiveContent([{ ...blank, diveSiteId: "site-1" }])).toBe(true);
    expect(hasTripDiveContent([{ ...blank, description: "Drift" }])).toBe(true);
  });
});
