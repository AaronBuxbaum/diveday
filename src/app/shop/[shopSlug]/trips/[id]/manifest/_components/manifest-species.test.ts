import { describe, expect, it } from "vitest";
import { manifestSpecies } from "./manifest-species";

describe("manifestSpecies", () => {
  it("names the whole catalog and each site's guide in the reader's language", () => {
    const { catalogSpecies, speciesBySite } = manifestSpecies(
      "es-ES",
      new Map([["site-reef", [{ id: "guide-1", catalogSlug: "blue-chromis" }]]]) as never,
    );
    expect(catalogSpecies.length).toBeGreaterThan(10);
    const chromis = catalogSpecies.find((species) => species.slug === "blue-chromis");
    expect(speciesBySite["site-reef"]).toEqual([chromis]);
  });
});
