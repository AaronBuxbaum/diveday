import { describe, expect, it } from "vitest";
import { DIVE_SITE_SLUG_MAX, diveSiteSlugFrom, parseDiveSiteSlug } from "./dive-site-slug";

describe("diveSiteSlugFrom", () => {
  it("takes the shop's own name for the place", () => {
    expect(diveSiteSlugFrom("Molasses Reef")).toBe("molasses-reef");
    expect(diveSiteSlugFrom("Christ of the Abyss")).toBe("christ-of-the-abyss");
  });

  it("folds accents rather than dropping them", () => {
    expect(diveSiteSlugFrom("Cañón de las Ánimas")).toBe("canon-de-las-animas");
  });

  it("collapses punctuation to single hyphens and trims the ends", () => {
    expect(diveSiteSlugFrom("  The Duane — 27m/90ft!  ")).toBe("the-duane-27m-90ft");
  });

  it("falls back rather than minting a row no URL can name", () => {
    expect(diveSiteSlugFrom("!!!")).toBe("dive-site");
  });

  it("suffixes a collision, keeping the suffix inside the cap", () => {
    expect(diveSiteSlugFrom("Molasses Reef", ["molasses-reef"])).toBe("molasses-reef-2");
    expect(diveSiteSlugFrom("Molasses Reef", ["molasses-reef", "molasses-reef-2"])).toBe(
      "molasses-reef-3",
    );
    const long = "a".repeat(DIVE_SITE_SLUG_MAX + 20);
    const first = diveSiteSlugFrom(long);
    expect(first).toHaveLength(DIVE_SITE_SLUG_MAX);
    const second = diveSiteSlugFrom(long, [first]);
    expect(second).toHaveLength(DIVE_SITE_SLUG_MAX);
    expect(second).not.toBe(first);
  });
});

describe("parseDiveSiteSlug", () => {
  it("takes a well-formed segment", () => {
    expect(parseDiveSiteSlug("molasses-reef")).toBe("molasses-reef");
  });

  it("refuses anything that could never have been minted", () => {
    // Each of these would otherwise reach a query as a shop-scoped lookup key.
    for (const bad of [undefined, "", "Molasses-Reef", "molasses reef", "-reef", "reef-", "a/b"]) {
      expect(parseDiveSiteSlug(bad)).toBeNull();
    }
    expect(parseDiveSiteSlug("a".repeat(DIVE_SITE_SLUG_MAX + 1))).toBeNull();
  });
});
