import { describe, expect, it } from "vitest";
import { MARINE_LIFE_CATALOG } from "@/db/marine-life-catalog";
import { MAX_SITE_CREATURES, parseFieldGuideSelection } from "./dive-site-field-guide";

const slugs = MARINE_LIFE_CATALOG.map((species) => species.slug);
const [butterflyfish, hamlet, third] = slugs;

/**
 * The parser is the whole safety property of the selection model (ADR
 * 20260813-marine-life-is-diveday-copy): past it, every stored row is a slug
 * the bundles have words for in every locale, and nothing a shop typed can
 * reach a diver. The input arrives from a hidden form field, a template blob
 * or an old row — so every shape below is one the app has actually been sent.
 */
describe("parseFieldGuideSelection", () => {
  it("keeps catalog slugs in the order the shop chose", () => {
    expect(parseFieldGuideSelection([hamlet, butterflyfish])).toEqual([hamlet, butterflyfish]);
  });

  it("parses the form's hidden JSON string the same way as a decoded array", () => {
    expect(parseFieldGuideSelection(JSON.stringify([butterflyfish, hamlet]))).toEqual([
      butterflyfish,
      hamlet,
    ]);
  });

  it("drops a slug the catalog does not carry rather than storing it", () => {
    expect(parseFieldGuideSelection([butterflyfish, "kraken", hamlet])).toEqual([
      butterflyfish,
      hamlet,
    ]);
  });

  it("never lets free text through, whatever the old object shape carried", () => {
    // The pre-selection editor posted words beside the slug; only the slug survives.
    const posted = [
      { slug: butterflyfish, name: "<script>alert(1)</script>", description: "typed by a shop" },
      { name: "no slug at all" },
      { slug: 42 },
      { slug: "not-a-species" },
    ];
    expect(parseFieldGuideSelection(posted)).toEqual([butterflyfish]);
  });

  it("trims whitespace around a slug before matching it", () => {
    expect(parseFieldGuideSelection([`  ${hamlet} `])).toEqual([hamlet]);
  });

  it("removes repeats, keeping the first position", () => {
    expect(
      parseFieldGuideSelection([hamlet, butterflyfish, hamlet, { slug: butterflyfish }]),
    ).toEqual([hamlet, butterflyfish]);
  });

  it(`caps the guide at ${MAX_SITE_CREATURES} species`, () => {
    const many = slugs.slice(0, MAX_SITE_CREATURES + 3);
    expect(many.length).toBeGreaterThan(MAX_SITE_CREATURES);
    expect(parseFieldGuideSelection(many)).toEqual(many.slice(0, MAX_SITE_CREATURES));
  });

  it("counts only accepted entries against the cap", () => {
    const padded = [...Array.from({ length: MAX_SITE_CREATURES }, () => "kraken"), butterflyfish];
    expect(parseFieldGuideSelection(padded)).toEqual([butterflyfish]);
  });

  it("answers an empty guide for every shape that is not a list, and never throws", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "banana",
      "{",
      "{}",
      '"' + butterflyfish + '"',
      7,
      {},
      true,
    ]) {
      expect(parseFieldGuideSelection(raw)).toEqual([]);
    }
  });

  it("skips entries that are neither a string nor an object", () => {
    expect(parseFieldGuideSelection([null, 1, true, [third], third])).toEqual([third]);
  });
});
