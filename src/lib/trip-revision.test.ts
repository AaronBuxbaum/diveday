import { describe, expect, it } from "vitest";
import { tripSiteList, tripSiteListChanged } from "./trip-revision";

const reef = "site-reef";
const wreck = "site-wreck";

describe("tripSiteList", () => {
  it("orders by dive number rather than by however the rows came back", () => {
    expect(
      tripSiteList([
        { diveNumber: 2, diveSiteId: wreck },
        { diveNumber: 1, diveSiteId: reef },
      ]),
    ).toEqual([reef, wreck]);
  });

  it("keeps an unchosen site as a member of the list, not as a gap", () => {
    expect(
      tripSiteList([
        { diveNumber: 1, diveSiteId: reef },
        { diveNumber: 2, diveSiteId: null },
      ]),
    ).toEqual([reef, null]);
  });
});

describe("tripSiteListChanged", () => {
  it("is unchanged when the same sites come back in the same order", () => {
    expect(tripSiteListChanged([reef, wreck], [reef, wreck])).toBe(false);
  });

  it("counts a reorder, because the diver's day is a different day", () => {
    expect(tripSiteListChanged([reef, wreck], [wreck, reef])).toBe(true);
  });

  it("counts a swapped site", () => {
    expect(tripSiteListChanged([reef, wreck], [reef, "site-ledge"])).toBe(true);
  });

  it("counts an added leg", () => {
    expect(tripSiteListChanged([reef], [reef, wreck])).toBe(true);
  });

  it("counts a leg that lost its site, and one that gained one", () => {
    expect(tripSiteListChanged([reef, wreck], [reef, null])).toBe(true);
    expect(tripSiteListChanged([reef, null], [reef, wreck])).toBe(true);
  });

  it("says nothing moved when a title-only edit leaves the plan alone", () => {
    // The caller passes the same two site lists either side of an edit that
    // only touched words; nothing about the plan moved, so nothing bumps.
    const before = tripSiteList([
      { diveNumber: 1, diveSiteId: reef },
      { diveNumber: 2, diveSiteId: wreck },
    ]);
    const after = tripSiteList([
      { diveNumber: 1, diveSiteId: reef },
      { diveNumber: 2, diveSiteId: wreck },
    ]);
    expect(tripSiteListChanged(before, after)).toBe(false);
  });

  it("treats two empty plans as unchanged", () => {
    expect(tripSiteListChanged([], [])).toBe(false);
  });
});
