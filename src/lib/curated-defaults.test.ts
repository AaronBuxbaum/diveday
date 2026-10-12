import { describe, expect, it } from "vitest";
import { siteCatalogIsLocal } from "./curated-defaults";

/** UX review 2026-10-11, item 15: the Florida catalog is offered only to a Florida shop. */
describe("siteCatalogIsLocal", () => {
  it("offers the catalog to a Florida address", () => {
    expect(
      siteCatalogIsLocal({
        timezone: "America/New_York",
        addressCountry: "US",
        addressRegion: "FL",
      }),
    ).toBe(true);
    expect(siteCatalogIsLocal({ timezone: "America/New_York", addressRegion: "Florida" })).toBe(
      true,
    );
  });

  it("does not offer it to a shop elsewhere, whatever its zone", () => {
    expect(siteCatalogIsLocal({ timezone: "America/Cancun", addressCountry: "MX" })).toBe(false);
    expect(siteCatalogIsLocal({ timezone: "America/Curacao" })).toBe(false);
    expect(
      siteCatalogIsLocal({
        timezone: "America/New_York",
        addressCountry: "US",
        addressRegion: "NC",
      }),
    ).toBe(false);
    expect(siteCatalogIsLocal({ timezone: "America/New_York", addressCountry: "BS" })).toBe(false);
    expect(siteCatalogIsLocal({ timezone: "America/Los_Angeles", addressCountry: "US" })).toBe(
      false,
    );
  });

  it("guesses from the Eastern zone when no address is on file", () => {
    expect(siteCatalogIsLocal({ timezone: "America/New_York" })).toBe(true);
    expect(
      siteCatalogIsLocal({ timezone: "America/New_York", addressCountry: null, addressRegion: "" }),
    ).toBe(true);
  });
});
