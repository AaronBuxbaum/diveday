import { describe, expect, it } from "vitest";
import {
  LINK_CARD_SIZE,
  openGraphSite,
  sharedLinkCardImage,
  shopSearchListingRobots,
} from "./site-metadata";

describe("openGraphSite", () => {
  /**
   * **Adding `images` here would shadow four cards at once.** Next skips a
   * segment's own `opengraph-image` file whenever that level's `openGraph`
   * block carries an own `images` property (`mergeStaticMetadata` in
   * `next/dist/lib/metadata/resolve-metadata.js`), and every page that says
   * anything about its own unfurl spreads this constant — including the shop
   * schedule, a departure and a shared recap, each of which draws a card of
   * its own. The generic card would silently win on exactly the three pages
   * that have something better to show, and it would only be visible in
   * somebody else's chat window.
   */
  it("is only the site-level pair — never a url or an image, which are per page", () => {
    expect(openGraphSite).toEqual({ siteName: "DiveDay", type: "website" });
  });
});

describe("sharedLinkCardImage", () => {
  /**
   * The card is a route handler rather than `src/app/opengraph-image.tsx`, so
   * that Next does not attach a `next/og` import to every page entry in the app
   * (issue #1709). The trade is that nothing generates these fields any more:
   * the route draws the bitmap, this constant describes it, and a disagreement
   * between them unfurls wrong with nothing on screen to show it.
   */
  it("names the route that draws the card, at the size that route renders", () => {
    expect(sharedLinkCardImage.url).toBe("/link-card");
    expect(sharedLinkCardImage.width).toBe(LINK_CARD_SIZE.width);
    expect(sharedLinkCardImage.height).toBe(LINK_CARD_SIZE.height);
    // The dimensions the card shipped with, and what `summary_large_image`
    // promises a reader (docs/product/marketing.md, HD-25).
    expect(LINK_CARD_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("carries the alt text and content type the convention file used to export", () => {
    expect(sharedLinkCardImage.type).toBe("image/png");
    expect(sharedLinkCardImage.alt).toContain("DiveDay");
    expect(sharedLinkCardImage.alt).toContain("who's on the boat");
  });

  it("is a relative path, resolved against the layout's metadataBase", () => {
    // An absolute URL here would pin every unfurl to one origin, so a preview
    // deployment would advertise production's card and vice versa.
    expect(sharedLinkCardImage.url.startsWith("/")).toBe(true);
    expect(sharedLinkCardImage.url).not.toMatch(/^https?:/);
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
