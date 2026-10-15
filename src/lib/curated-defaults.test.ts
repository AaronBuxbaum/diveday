import { describe, expect, it } from "vitest";
import { DIVE_AREAS } from "@/content/dive-areas";
import { catalogAreasForShop } from "./curated-defaults";

/** UX review 2026-10-11, item 15; issue #2477: the catalog is offered by area, matched on the address. */
describe("catalogAreasForShop", () => {
  const florida = {
    code: "florida",
    region: { country: "US", subdivisions: ["FL", "FLORIDA"], timeZones: ["America/New_York"] },
  };
  const bonaire = {
    code: "bonaire",
    region: { country: "BQ", subdivisions: ["BO", "BONAIRE"], timeZones: ["America/Kralendijk"] },
  };
  const cayman = { code: "cayman", region: { country: "KY", timeZones: ["America/Cayman"] } };
  const areas = [florida, bonaire, cayman];
  const near = (shop: Parameters<typeof catalogAreasForShop>[0]) =>
    catalogAreasForShop(shop, areas).map((area) => area.code);

  it("offers Florida to a Florida address", () => {
    expect(
      near({ timezone: "America/New_York", addressCountry: "US", addressRegion: "FL" }),
    ).toEqual(["florida"]);
    expect(near({ timezone: "America/New_York", addressRegion: "Florida" })).toEqual(["florida"]);
  });

  it("never offers Florida to a New York-zone shop whose address is elsewhere", () => {
    expect(
      near({ timezone: "America/New_York", addressCountry: "US", addressRegion: "NC" }),
    ).toEqual([]);
    expect(near({ timezone: "America/New_York", addressCountry: "BS" })).toEqual([]);
    expect(near({ timezone: "America/Los_Angeles", addressCountry: "US" })).toEqual([]);
    expect(near({ timezone: "America/Cancun", addressCountry: "MX" })).toEqual([]);
  });

  it("matches a whole-country area on the country alone", () => {
    expect(near({ timezone: "America/New_York", addressCountry: "KY" })).toEqual(["cayman"]);
    expect(
      near({ timezone: "America/Cayman", addressCountry: "ky", addressRegion: "George Town" }),
    ).toEqual(["cayman"]);
  });

  it("needs the subdivision where one country holds other places", () => {
    expect(
      near({ timezone: "America/Kralendijk", addressCountry: "BQ", addressRegion: "BO" }),
    ).toEqual(["bonaire"]);
    expect(
      near({ timezone: "America/Kralendijk", addressCountry: "BQ", addressRegion: "SA" }),
    ).toEqual([]);
  });

  it("guesses from the zone only when no address says otherwise", () => {
    expect(near({ timezone: "America/New_York" })).toEqual(["florida"]);
    expect(near({ timezone: "America/New_York", addressCountry: null, addressRegion: "" })).toEqual(
      ["florida"],
    );
    expect(near({ timezone: "America/Cayman" })).toEqual(["cayman"]);
    expect(near({ timezone: "America/Curacao" })).toEqual([]);
  });
  it("offers a Caribbean shop the areas its own address names, and no others", () => {
    const real = (shop: Parameters<typeof catalogAreasForShop>[0]) =>
      catalogAreasForShop(shop, DIVE_AREAS).map((area) => area.code);
    expect(
      real({ timezone: "America/Cancun", addressCountry: "MX", addressRegion: "ROO" }),
    ).toEqual(["mexico-cozumel", "mexico-riviera-maya", "mexico-cenotes", "mexico-costa-maya"]);
    expect(
      real({ timezone: "America/Merida", addressCountry: "MX", addressRegion: "Yucatán" }),
    ).toEqual(["mexico-cenotes"]);
    expect(
      real({ timezone: "America/Mazatlan", addressCountry: "MX", addressRegion: "BCS" }),
    ).toEqual([]);
    expect(
      real({ timezone: "America/Kralendijk", addressCountry: "BQ", addressRegion: "Saba" }),
    ).toEqual(["saba"]);
    expect(
      real({ timezone: "America/Tegucigalpa", addressCountry: "HN", addressRegion: "IB" }),
    ).toEqual(["honduras-roatan", "honduras-utila", "honduras-guanaja"]);
    expect(
      real({ timezone: "America/Tegucigalpa", addressCountry: "HN", addressRegion: "FM" }),
    ).toEqual([]);
    expect(real({ timezone: "America/Lower_Princes" })).toEqual(["sint-maarten"]);
  });
});
