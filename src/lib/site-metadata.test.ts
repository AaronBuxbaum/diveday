import { describe, expect, it } from "vitest";
import { openGraphSite, shopSearchListingRobots } from "./site-metadata";

describe("openGraphSite", () => {
  it("is only the site-level pair — never a url or an image, which are per page", () => {
    expect(openGraphSite).toEqual({ siteName: "DiveDay", type: "website" });
  });
});

describe("shopSearchListingRobots", () => {
  it("is absent for a shop that has not opted out, so the page inherits the site default", () => {
    expect(shopSearchListingRobots(null)).toBeUndefined();
    expect(shopSearchListingRobots(undefined)).toBeUndefined();
  });

  it("says no to indexing and following once the shop has opted out", () => {
    expect(shopSearchListingRobots(new Date("2026-08-13T12:00:00Z"))).toEqual({
      index: false,
      follow: false,
    });
  });
});
