import { describe, expect, it } from "vitest";
import { isRegionSlug, REGIONS_PATH, regionPath, regionSlugFromLocality } from "./region";

describe("regionSlugFromLocality", () => {
  it("spells a town the way the route does", () => {
    expect(regionSlugFromLocality("Key Largo")).toBe("key-largo");
    expect(regionSlugFromLocality("Islamorada")).toBe("islamorada");
    expect(regionSlugFromLocality("St. Thomas")).toBe("st-thomas");
  });

  it("folds case, spacing and punctuation so two shops typing the same place meet", () => {
    expect(regionSlugFromLocality("  KEY   LARGO ")).toBe("key-largo");
    expect(regionSlugFromLocality("Key-Largo")).toBe("key-largo");
    expect(regionSlugFromLocality("Key Largo, FL")).toBe("key-largo-fl");
  });

  it("strips diacritics rather than dropping the letter", () => {
    expect(regionSlugFromLocality("Cozúmel")).toBe("cozumel");
    expect(regionSlugFromLocality("Bahía de Banderas")).toBe("bahia-de-banderas");
  });

  it("is null for nothing, blanks, and a locality made only of punctuation", () => {
    expect(regionSlugFromLocality(null)).toBeNull();
    expect(regionSlugFromLocality(undefined)).toBeNull();
    expect(regionSlugFromLocality("")).toBeNull();
    expect(regionSlugFromLocality("   ")).toBeNull();
    expect(regionSlugFromLocality("---")).toBeNull();
  });

  it("truncates an absurd locality at a word boundary and stays a valid slug", () => {
    const long = Array.from({ length: 20 }, (_, i) => `place${i}`).join(" ");
    const slug = regionSlugFromLocality(long);
    expect(slug).not.toBeNull();
    expect((slug ?? "").length).toBeLessThanOrEqual(64);
    expect(isRegionSlug(slug)).toBe(true);
  });
});

describe("isRegionSlug", () => {
  it("accepts what the derivation produces and refuses everything else", () => {
    expect(isRegionSlug("key-largo")).toBe(true);
    expect(isRegionSlug("cozumel")).toBe(true);
    expect(isRegionSlug("Key-Largo")).toBe(false);
    expect(isRegionSlug("key largo")).toBe(false);
    expect(isRegionSlug("-key-largo")).toBe(false);
    expect(isRegionSlug("key--largo")).toBe(false);
    expect(isRegionSlug("")).toBe(false);
    expect(isRegionSlug(null)).toBe(false);
    expect(isRegionSlug("../etc")).toBe(false);
  });
});

describe("regionPath", () => {
  it("puts a region under the index", () => {
    expect(REGIONS_PATH).toBe("/dive");
    expect(regionPath("key-largo")).toBe("/dive/key-largo");
  });
});
