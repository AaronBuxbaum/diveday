import { describe, expect, it } from "vitest";
import {
  addressLookupConfigFromEnvironment,
  isAddressLookupConfigured,
  isLookupWorthy,
  MAX_ADDRESS_QUERY_LENGTH,
  MIN_ADDRESS_QUERY_LENGTH,
  toShopAddressFields,
} from "./address-lookup";

describe("what is worth a billed lookup", () => {
  it("refuses a query too short to mean anything", () => {
    expect(isLookupWorthy("")).toBe(false);
    expect(isLookupWorthy("a".repeat(MIN_ADDRESS_QUERY_LENGTH - 1))).toBe(false);
    // Whitespace is not length: "  a  " is one character of address.
    expect(isLookupWorthy("  a  ")).toBe(false);
  });

  it("accepts a real partial address", () => {
    expect(isLookupWorthy("102 Ocean")).toBe(true);
    expect(isLookupWorthy("a".repeat(MIN_ADDRESS_QUERY_LENGTH))).toBe(true);
  });

  it("refuses a body too large to be an address", () => {
    // The box must never become a way to push a large payload at a metered
    // third-party API on the shop's own account.
    expect(isLookupWorthy("a".repeat(MAX_ADDRESS_QUERY_LENGTH))).toBe(true);
    expect(isLookupWorthy("a".repeat(MAX_ADDRESS_QUERY_LENGTH + 1))).toBe(false);
  });
});

describe("folding a looked-up place into the five columns", () => {
  it("joins the street number and street into the one line the column holds", () => {
    expect(toShopAddressFields({ streetNumber: "102", street: "Ocean Drive" }).addressStreet).toBe(
      "102 Ocean Drive",
    );
  });

  it("does not leave a dangling space when only one part is known", () => {
    expect(toShopAddressFields({ street: "Ocean Drive" }).addressStreet).toBe("Ocean Drive");
    expect(toShopAddressFields({ streetNumber: "102" }).addressStreet).toBe("102");
  });

  it("normalizes the country to upper-case alpha-2, which is what the column stores", () => {
    expect(toShopAddressFields({ countryCode: "us" }).addressCountry).toBe("US");
    // A provider that hands back alpha-3 must not overflow a two-char column.
    expect(toShopAddressFields({ countryCode: "USA" }).addressCountry).toBe("US");
  });

  it("returns every field, so picking a place replaces the address rather than merging into it", () => {
    // A place with no postcode has to *clear* the postcode box. Half of one
    // address and half of another is worse than either.
    expect(toShopAddressFields({ street: "Ocean Drive" })).toEqual({
      addressStreet: "Ocean Drive",
      addressLocality: "",
      addressRegion: "",
      addressPostalCode: "",
      addressCountry: "",
    });
  });

  it("trims what the provider sends", () => {
    expect(toShopAddressFields({ locality: "  Key Largo  " }).addressLocality).toBe("Key Largo");
  });
});

describe("configuration", () => {
  const full = {
    PLACES_AWS_REGION: "us-east-1",
    PLACES_AWS_ACCESS_KEY_ID: "AKIA_EXAMPLE",
    PLACES_AWS_SECRET_ACCESS_KEY: "secret",
  } as unknown as NodeJS.ProcessEnv;

  it("reads its own key pair, not the mail or SMS sender's", () => {
    expect(addressLookupConfigFromEnvironment(full)).toEqual({
      region: "us-east-1",
      accessKeyId: "AKIA_EXAMPLE",
      secretAccessKey: "secret",
    });
    expect(isAddressLookupConfigured(full)).toBe(true);
  });

  it("is simply unconfigured when any part is missing — the ordinary local case", () => {
    for (const key of Object.keys(full)) {
      const partial = { ...full, [key]: undefined };
      expect(addressLookupConfigFromEnvironment(partial)).toBeNull();
      expect(isAddressLookupConfigured(partial)).toBe(false);
    }
    expect(addressLookupConfigFromEnvironment({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("treats a blank value as absent rather than sending an empty credential", () => {
    expect(
      addressLookupConfigFromEnvironment({ ...full, PLACES_AWS_ACCESS_KEY_ID: "   " }),
    ).toBeNull();
  });
});
