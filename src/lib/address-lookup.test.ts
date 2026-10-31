import { describe, expect, it } from "vitest";
import {
  addressLookupConfigFromEnvironment,
  classifyLookupError,
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
    expect(
      toShopAddressFields({ streetNumber: "102", street: "Ocean Drive", countryCode: "US" })
        ?.addressStreet,
    ).toBe("102 Ocean Drive");
  });

  it("does not leave a dangling space when only one part is known", () => {
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "US" })?.addressStreet).toBe(
      "Ocean Drive",
    );
    expect(toShopAddressFields({ streetNumber: "102", countryCode: "US" })?.addressStreet).toBe(
      "102",
    );
  });

  it("accepts an ISO alpha-2 country in any case, which is what the column stores", () => {
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "us" })?.addressCountry).toBe(
      "US",
    );
  });

  it("accepts Kosovo's XK, which AWS Location documents as its two-letter code", () => {
    expect(
      toShopAddressFields({ street: "Mother Teresa", countryCode: "XK" })?.addressCountry,
    ).toBe("XK");
  });

  it("refuses a country that is not an ISO alpha-2 code, rather than truncating it", () => {
    // Alpha-3 is not cut to two letters: "MEX" would become "ME", a different country.
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "USA" })).toBeNull();
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "MEX" })).toBeNull();
    // "UK" is common and not the ISO code, which is GB.
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "UK" })).toBeNull();
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "U" })).toBeNull();
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "" })).toBeNull();
    expect(toShopAddressFields({ street: "Ocean Drive" })).toBeNull();
  });

  it("returns every field, so picking a place replaces the address rather than merging into it", () => {
    // A place with no postcode has to *clear* the postcode box. Half of one
    // address and half of another is worse than either.
    expect(toShopAddressFields({ street: "Ocean Drive", countryCode: "US" })).toEqual({
      addressStreet: "Ocean Drive",
      addressLocality: "",
      addressRegion: "",
      addressPostalCode: "",
      addressCountry: "US",
      latitude: null,
      longitude: null,
    });
  });

  it("trims what the provider sends", () => {
    expect(
      toShopAddressFields({ locality: "  Key Largo  ", countryCode: " US " })?.addressLocality,
    ).toBe("Key Largo");
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

/**
 * The three deployment mistakes that produce an identical dead lookup, and the
 * one provider answer that is not a mistake at all. Sorting them is the whole
 * point: `failed` on its own sent a reproducible outage round-trip through a
 * follow-up register and a second bug report without ever naming its cause.
 */
describe("sorting a thrown provider error into something actionable", () => {
  it("calls a rejected or under-permitted credential denied", () => {
    expect(classifyLookupError({ name: "AccessDeniedException", status: 403 })).toEqual({
      status: "failed",
      reason: "denied",
    });
    // The key is not one this account knows — a stale or mistyped paste.
    expect(classifyLookupError({ name: "UnrecognizedClientException", status: 403 })).toEqual({
      status: "failed",
      reason: "denied",
    });
    // A 403 with a name nobody has seen before is still a 403.
    expect(classifyLookupError({ name: "SomeNewException", status: 403 })).toEqual({
      status: "failed",
      reason: "denied",
    });
  });

  it("calls a host that never answered unreachable — which is what a wrong region looks like", () => {
    // The SDK builds `geo-places.<region>.amazonaws.com` out of the configured
    // region, so a region that does not serve the API fails in DNS: there is no
    // HTTP status to read, and no AWS exception name either.
    expect(classifyLookupError({ name: "Error", code: "ENOTFOUND", status: null })).toEqual({
      status: "failed",
      reason: "unreachable",
    });
    expect(classifyLookupError({ name: "TimeoutError" })).toEqual({
      status: "failed",
      reason: "unreachable",
    });
  });

  it("does not read a transport code as unreachable when the provider did answer", () => {
    // An SDK can hang a code off an ordinary refusal; something that answered
    // 400 is reachable by definition.
    expect(
      classifyLookupError({ name: "ValidationException", code: "ECONNRESET", status: 400 }),
    ).toEqual({ status: "failed", reason: "rejected" });
  });

  it("reports the provider's own throttle as resting, not as broken", () => {
    // The temporary, self-healing state already exists and has its own
    // sentence; it was wired only to DiveDay's per-staffer limiter, so the
    // provider saying the identical thing arrived as a dead end.
    expect(classifyLookupError({ name: "ThrottlingException", status: 400 })).toEqual({
      status: "rate_limited",
    });
    expect(classifyLookupError({ name: "TooManyRequestsException", status: 429 })).toEqual({
      status: "rate_limited",
    });
  });

  it("falls back to unknown rather than guessing", () => {
    expect(classifyLookupError({ name: "InternalServerException", status: 500 })).toEqual({
      status: "failed",
      reason: "unknown",
    });
    expect(classifyLookupError({})).toEqual({ status: "failed", reason: "unknown" });
  });
});
