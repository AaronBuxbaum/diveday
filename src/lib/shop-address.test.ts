import { describe, expect, it } from "vitest";
import { shopAddressLines, shopMapQuery } from "./shop-address";

const FULL = {
  street: "100 Ocean Drive",
  locality: "Key Largo",
  region: "FL",
  postalCode: "33037",
  country: "US",
};

const NONE = { street: null, locality: null, region: null, postalCode: null, country: null };

describe("shopAddressLines", () => {
  it("lays a complete address out in postal order", () => {
    expect(shopAddressLines(FULL)).toEqual(["100 Ocean Drive", "Key Largo, FL 33037", "US"]);
  });

  it("drops missing parts instead of leaving stray punctuation", () => {
    expect(shopAddressLines({ ...NONE, street: "12 Quay St", country: "NZ" })).toEqual([
      "12 Quay St",
      "NZ",
    ]);
    expect(shopAddressLines({ ...NONE, locality: "Cozumel" })).toEqual(["Cozumel"]);
    expect(shopAddressLines({ ...FULL, region: null })).toEqual([
      "100 Ocean Drive",
      "Key Largo, 33037",
      "US",
    ]);
  });

  it("treats whitespace-only fields as absent", () => {
    expect(shopAddressLines({ ...NONE, street: "   ", locality: "\t" })).toEqual([]);
  });

  it("returns nothing for a shop with no address on file", () => {
    expect(shopAddressLines(NONE)).toEqual([]);
  });
});

describe("shopMapQuery", () => {
  it("names the shop and its address so a map lands on the right door", () => {
    expect(shopMapQuery("Drifting Shallows Divers", FULL)).toBe(
      "Drifting Shallows Divers, 100 Ocean Drive, Key Largo, FL 33037, US",
    );
  });

  it("still resolves from a locality alone", () => {
    expect(shopMapQuery("Reef Co", { ...NONE, locality: "Cozumel", country: "MX" })).toBe(
      "Reef Co, Cozumel, MX",
    );
  });

  /**
   * The point of the guard: a country (or a postcode) with no street and no
   * town would centre a map on a whole nation and present it as the shop's
   * address. Better to draw no map at all.
   */
  it("refuses to build a query with nothing to point at", () => {
    expect(shopMapQuery("Reef Co", NONE)).toBeNull();
    expect(shopMapQuery("Reef Co", { ...NONE, country: "US" })).toBeNull();
    expect(shopMapQuery("Reef Co", { ...NONE, postalCode: "33037", country: "US" })).toBeNull();
  });
});
