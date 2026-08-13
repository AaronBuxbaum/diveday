import { describe, expect, it } from "vitest";
import { fieldGuideCards, marineLifeCard } from "./marine-life-labels";
import { diverTranslator } from "./messages";

const en = diverTranslator("en-US");
const es = diverTranslator("es-ES");

/** A `dive_site_creatures` row, as the readers actually receive it. */
function row(id: string, catalogSlug: string | null) {
  return { id, catalogSlug };
}

describe("marineLifeCard", () => {
  it("answers in the reader's language, off the same slug", () => {
    // The whole point of the change: one stored row, two languages, decided by
    // who is looking rather than by who typed (ADR
    // 20260813-marine-life-is-diveday-copy).
    expect(marineLifeCard("stoplight-parrotfish", en)).toMatchObject({
      name: "Stoplight parrotfish",
      kind: "Reef fish",
    });
    expect(marineLifeCard("stoplight-parrotfish", es)).toMatchObject({
      name: "Loro semáforo",
      kind: "Pez de arrecife",
    });
  });

  it("keeps the Latin binomial and the photo out of the bundles", () => {
    // Both are the same in every language, and holding either as copy would
    // mean maintaining two versions of a value with one correct form.
    const card = marineLifeCard("green-moray", es);
    expect(card.scientificName).toBe("Gymnothorax funebris");
    expect(card.imageUrl).toBe("/marine-life/green-moray.jpg");
    expect(marineLifeCard("green-moray", en).scientificName).toBe(card.scientificName);
  });
});

describe("fieldGuideCards", () => {
  it("keeps the order the shop saved", () => {
    const cards = fieldGuideCards(
      [row("a", "green-moray"), row("b", "blue-tang"), row("c", "nurse-shark")],
      en,
    );
    expect(cards.map((card) => card.slug)).toEqual(["green-moray", "blue-tang", "nurse-shark"]);
    expect(cards.map((card) => card.id)).toEqual(["a", "b", "c"]);
  });

  it("skips a row naming a species the catalog no longer carries", () => {
    // An older release could have written it, and a catalog entry can be
    // retired. One card fewer is a better briefing than one card of nothing.
    const cards = fieldGuideCards([row("a", "blue-tang"), row("b", "megalodon")], en);
    expect(cards.map((card) => card.slug)).toEqual(["blue-tang"]);
  });

  it("skips a row a shop wrote itself before the catalog became app copy", () => {
    // `catalog_slug` was nullable for species a shop typed by hand. Those rows
    // have no words in any bundle; rendering one would put a blank tile on a
    // diver's briefing.
    expect(fieldGuideCards([row("a", null), row("b", "")], en)).toEqual([]);
  });

  it("renders nothing for a site with no field guide", () => {
    // A first-class answer, not an edge case: a site the shop has nothing to
    // say about yet is the ordinary state, and the briefing reads fine in it.
    expect(fieldGuideCards([], es)).toEqual([]);
  });
});
