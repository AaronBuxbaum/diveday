import { describe, expect, it } from "vitest";
import { summarizeTripDiveSites, tripDiveDraftsFromForm } from "./trip-dives";

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
    form.set("dive-2-title", "");
    form.set("dive-2-siteId", "");
    expect(tripDiveDraftsFromForm(form, 2)).toEqual([
      { title: "Benwood Wreck", diveSiteId: "site-a", description: "Bow to stern." },
      { title: null, diveSiteId: null, description: null },
    ]);
  });
});
