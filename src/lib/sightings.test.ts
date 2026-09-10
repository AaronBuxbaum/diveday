import { describe, expect, it } from "vitest";
import { DAY_MS } from "./clock";
import {
  MAX_SEEN_CHIPS,
  MAX_SIGHTING_SPECIES,
  rankSiteSightings,
  SIGHTING_WINDOW_DAYS,
  seenChipSlugs,
  seenSiteFor,
  sightingWindowStart,
} from "./sightings";

const NOW = new Date("2026-09-10T15:00:00Z");

function tally(speciesSlug: string, dives: number, total = dives) {
  return { speciesSlug, dives, total, lastSeenAt: NOW };
}

describe("sightingWindowStart", () => {
  it("reaches back a trailing thirty days, not to the first of the month", () => {
    // The calendar month is worst exactly where a diver reads it: on the 2nd, a
    // shop that dived every day for five weeks would show one dive.
    expect(NOW.getTime() - sightingWindowStart(NOW).getTime()).toBe(SIGHTING_WINDOW_DAYS * DAY_MS);
  });
});

describe("rankSiteSightings", () => {
  it("says nothing at all for a site with no log", () => {
    // A heading over an empty list is a page apologising for a feature the crew
    // has not used; the beat renders nothing instead.
    expect(rankSiteSightings({ diveSiteId: "site", dives: 4, tallies: [] })).toBeNull();
  });

  it("ranks by departures seen, then by how many, then by slug", () => {
    const ranked = rankSiteSightings({
      diveSiteId: "site",
      dives: 6,
      tallies: [
        tally("queen-angelfish", 2, 2),
        tally("green-sea-turtle", 5, 9),
        tally("nurse-shark", 2, 7),
        tally("blue-tang", 2, 2),
      ],
    });
    // A tie on departures is broken by the total, and a tie on both by the slug
    // — a list that reshuffles between two page loads reads as noise.
    expect(ranked?.species.map((row) => row.speciesSlug)).toEqual([
      "green-sea-turtle",
      "nurse-shark",
      "blue-tang",
    ]);
  });

  it("shows at most three species", () => {
    const ranked = rankSiteSightings({
      diveSiteId: "site",
      dives: 9,
      tallies: ["a", "b", "c", "d", "e"].map((slug, index) => tally(slug, 9 - index)),
    });
    expect(ranked?.species).toHaveLength(MAX_SIGHTING_SPECIES);
  });

  it("never reports more departures seeing a thing than there were departures", () => {
    // The numerator and the denominator come from two queries, and a numerator
    // larger than its denominator is the one output here that would read as a
    // lie rather than as an approximation.
    const ranked = rankSiteSightings({
      diveSiteId: "site",
      dives: 1,
      tallies: [tally("green-sea-turtle", 4, 4)],
    });
    expect(ranked?.dives).toBe(4);
    expect(ranked?.species[0]?.dives).toBe(4);
  });
});

describe("seenChipSlugs", () => {
  const siteGuide = ["southern-stingray", "goliath-grouper"];
  const shopPicks = ["nurse-shark", "green-moray"];
  const catalog = ["blue-tang", "queen-angelfish"];

  it("offers the site's own faces first, then the shop's, then the catalog", () => {
    expect(seenChipSlugs({ siteGuide, shopPicks, catalog })).toEqual([
      ...siteGuide,
      ...shopPicks,
      ...catalog,
    ]);
  });

  it("gives a shop that has never picked a species something to tap", () => {
    // The day a shop first takes a boat out is the day this is most worth
    // having, and it is exactly the day its field guides are empty.
    expect(seenChipSlugs({ siteGuide: [], shopPicks: [], catalog })).toEqual(catalog);
  });

  it("never repeats a species that two rungs both name", () => {
    expect(
      seenChipSlugs({ siteGuide: ["nurse-shark"], shopPicks: ["nurse-shark"], catalog: [] }),
    ).toEqual(["nurse-shark"]);
  });

  it("bounds the row", () => {
    const many = Array.from({ length: 40 }, (_, index) => `species-${index}`);
    expect(seenChipSlugs({ siteGuide: [], shopPicks: [], catalog: many })).toHaveLength(
      MAX_SEEN_CHIPS,
    );
  });
});

describe("seenSiteFor", () => {
  const molasses = { id: "molasses", name: "Molasses Reef" };
  const french = { id: "french", name: "French Reef" };

  it("believes the record over the plan", () => {
    expect(seenSiteFor({ recorded: { actualSite: french }, planned: molasses })).toBe(french);
  });

  it("answers nothing when the crew recorded the site as unknown", () => {
    // The boat went somewhere else, or the dive was called. Attributing those
    // taps to the reef on the plan would publish "seen here this month" for a
    // site the boat never reached — which is the one thing this beat must not
    // do, because a diver cannot tell it apart from a real sighting.
    expect(seenSiteFor({ recorded: { actualSite: null }, planned: molasses })).toBeNull();
  });

  it("falls back to the plan only when nothing was recorded at all", () => {
    expect(seenSiteFor({ recorded: undefined, planned: molasses })).toBe(molasses);
    expect(seenSiteFor({ recorded: undefined, planned: null })).toBeNull();
  });
});
