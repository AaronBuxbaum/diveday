import { describe, expect, it, vi } from "vitest";
import { awsAddressLookupProvider } from "./address-lookup-aws";

const config = { region: "us-east-1", accessKeyId: "AKIA_EXAMPLE", secretAccessKey: "secret" };

/** A client that answers every send with one canned response. */
function clientReturning(response: unknown) {
  return { send: vi.fn().mockResolvedValue(response) };
}

const CORE_ADDRESS = {
  Label: "102 Ocean Drive, Key Largo, FL 33037, United States",
  AddressNumber: "102",
  Street: "Ocean Drive",
  Locality: "Key Largo",
  Region: { Code: "FL", Name: "Florida" },
  PostalCode: "33037",
  Country: { Code2: "US" },
};

/** A plain address row: the title *is* the address line. */
const fullResult = {
  Title: "102 Ocean Drive, Key Largo, FL 33037, United States",
  SuggestResultItemType: "Place",
  Place: { PlaceId: "place-1", Address: CORE_ADDRESS },
};

/** A business row: the title is the shop's name, the address sits beneath it. */
const businessResult = {
  Title: "Rainbow Reef Dive Center",
  SuggestResultItemType: "Place",
  Place: { PlaceId: "poi-1", PlaceType: "PointOfInterest", Address: CORE_ADDRESS },
};

const withAddress = (address: Record<string, unknown>) => ({
  ...fullResult,
  Place: { ...fullResult.Place, Address: address },
});

describe("Amazon Location address suggestions", () => {
  it("maps a result into a pickable suggestion with the five columns filled", async () => {
    const client = clientReturning({ ResultItems: [fullResult] });
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");

    expect(result).toEqual({
      status: "ok",
      suggestions: [
        {
          id: "place-1",
          label: "102 Ocean Drive, Key Largo, FL 33037, United States",
          // The title already *is* the address line; repeating it underneath
          // itself would be noise.
          detail: undefined,
          address: {
            addressStreet: "102 Ocean Drive",
            addressLocality: "Key Largo",
            addressRegion: "FL",
            addressPostalCode: "33037",
            addressCountry: "US",
          },
        },
      ],
    });
  });

  /**
   * The bug this file exists to keep fixed. The card shipped on `Autocomplete`,
   * which "completes partial queries with valid address completion" and answers
   * streets only — so a shop typing its own name got a working search box that
   * never found it, which is how the lookup was reported as broken while every
   * request succeeded (2026-08-11). A shop recalls "Rainbow Reef Dive Center"
   * instantly and its own postcode slowly, so the name is the query that
   * matters most.
   */
  it("finds a business by name, and keeps its name and its street apart", async () => {
    const client = clientReturning({ ResultItems: [businessResult] });
    const result = await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef");

    expect(result.status === "ok" && result.suggestions[0]).toEqual({
      id: "poi-1",
      // What the shop owner typed and therefore what they must recognize.
      label: "Rainbow Reef Dive Center",
      // The only thing that tells one franchise location from the next.
      detail: "102 Ocean Drive, Key Largo, FL 33037, United States",
      address: {
        addressStreet: "102 Ocean Drive",
        addressLocality: "Key Largo",
        addressRegion: "FL",
        addressPostalCode: "33037",
        addressCountry: "US",
      },
    });
  });

  it("asks the operation that answers places, not the one that only completes addresses", async () => {
    // `Autocomplete` cannot return a point of interest at all, so no amount of
    // mapping below it would have found a shop by name. Asserting the command
    // is what keeps the fix from being undone by a plausible-looking swap.
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef");
    expect(client.send.mock.calls[0][0].constructor.name).toBe("SuggestCommand");
  });

  it("asks for no query refinements, which are rows with nothing to save", async () => {
    // `Suggest` also answers with search terms to try next. They carry no place
    // and no address, so a picked one has nothing to write — they would only
    // crowd real answers out of a five-row list.
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef");
    const command = client.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.MaxQueryRefinements).toBe(0);
  });

  it("drops a query-refinement row that arrives anyway", async () => {
    const client = clientReturning({
      ResultItems: [
        { Title: "dive shops near me", SuggestResultItemType: "Query", Query: { QueryId: "q1" } },
        businessResult,
      ],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("dive shop");
    expect(result.status === "ok" && result.suggestions.map((s) => s.id)).toEqual(["poi-1"]);
  });

  it("prefers the short region code, which is what fits a one-line address", async () => {
    const client = clientReturning({
      ResultItems: [withAddress({ ...CORE_ADDRESS, Region: { Name: "Florida" } })],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result.status === "ok" && result.suggestions[0].address.addressRegion).toBe("Florida");
  });

  it("falls back to the district when a place carries no locality", async () => {
    // Inside a big city the town a diver would post a letter to often lands in
    // `District` rather than `Locality`.
    const client = clientReturning({
      ResultItems: [withAddress({ ...CORE_ADDRESS, Locality: undefined, District: "Brooklyn" })],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result.status === "ok" && result.suggestions[0].address.addressLocality).toBe(
      "Brooklyn",
    );
  });

  it("drops a result with nothing to key or read, rather than rendering a blank row", async () => {
    const client = clientReturning({
      ResultItems: [
        { Title: "no id", SuggestResultItemType: "Place", Place: { Address: CORE_ADDRESS } },
        { SuggestResultItemType: "Place", Place: { PlaceId: "p", Address: CORE_ADDRESS } },
      ],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result).toEqual({ status: "ok", suggestions: [] });
  });

  it("never spends a request on a query too short to mean anything", async () => {
    const client = clientReturning({ ResultItems: [fullResult] });
    const result = await awsAddressLookupProvider(config, { client }).suggest("10");
    expect(result).toEqual({ status: "too_short" });
    expect(client.send).not.toHaveBeenCalled();
  });

  it("degrades rather than throwing when the geocoder is down", async () => {
    // A geocoder being unavailable must never take the settings page with it:
    // the card says so and the shop's stored address is left alone.
    const client = { send: vi.fn().mockRejectedValue(new Error("boom")) };
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result).toEqual({ status: "failed", reason: "unknown" });
  });

  it("names the deployment mistake behind a failure instead of swallowing it", async () => {
    // The report this closes arrived as the literal response body
    // `{"status":"failed"}` from the network panel: three different broken
    // deployments and one healthy-but-throttled one all read identically, and
    // the only fact that told them apart lived in a log nobody reporting the
    // bug can reach.
    const denied = Object.assign(new Error("nope"), {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 403 },
    });
    const client = { send: vi.fn().mockRejectedValue(denied) };
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result).toEqual({ status: "failed", reason: "denied" });
  });

  it("reads a host that never resolved — a region that does not serve the API — as unreachable", async () => {
    const unresolved = Object.assign(
      new Error("getaddrinfo ENOTFOUND geo-places.example.amazonaws.com"),
      { code: "ENOTFOUND" },
    );
    const client = { send: vi.fn().mockRejectedValue(unresolved) };
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result).toEqual({ status: "failed", reason: "unreachable" });
  });

  it("hands an AWS throttle to the resting state, not to the dead end", async () => {
    // Spending the provider's budget is the same temporary thing as spending
    // DiveDay's own, and the card already has words for it.
    const throttled = Object.assign(new Error("slow down"), {
      name: "ThrottlingException",
      $metadata: { httpStatusCode: 400 },
    });
    const client = { send: vi.fn().mockRejectedValue(throttled) };
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result).toEqual({ status: "rate_limited" });
  });

  it("never lets the query back out through the log line", async () => {
    // An AWS error can echo the query, and the query is a partial business
    // address: the shape goes to the log, the message never does.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const echoing = Object.assign(new Error("Invalid QueryText: 102 Ocean Drive, Key Largo"), {
      name: "ValidationException",
      $metadata: { httpStatusCode: 400 },
    });
    const client = { send: vi.fn().mockRejectedValue(echoing) };
    await awsAddressLookupProvider(config, { client }).suggest("102 Ocean Drive");

    const line = warn.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain('"event":"address_lookup.failed"');
    expect(line).toContain('"reason":"rejected"');
    expect(line).not.toContain("Ocean");
    warn.mockRestore();
  });

  it("asks for a pickable list, not a catalogue, and sends the trimmed query", async () => {
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("  102 Ocean  ");
    const command = client.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.QueryText).toBe("102 Ocean");
    expect(command.input.MaxResults).toBe(5);
  });

  it("asks for the structured address breakdown, which the API withholds by default", async () => {
    // The regression this file missed for a release: the `Address` object comes
    // back holding a `Label` and nothing else unless `AdditionalFeatures:
    // ["Core"]` is asked for, and every test above hands the adapter a response
    // that already has a full `Address` on it — so the mapping was proven while
    // the request that earns the mapping was not. Without this the lookup
    // succeeds, lists real places, and saves an empty address over the shop's.
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    const command = client.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.AdditionalFeatures).toEqual(["Core"]);
  });

  it("drops a label-only result rather than offering one that wipes the address", async () => {
    // What a response looks like when the breakdown is missing: readable in the
    // list, and an emptied address the moment it is picked, because a pick
    // replaces every column and saves.
    const client = clientReturning({
      ResultItems: [
        {
          Title: "Key Largo, FL, United States",
          SuggestResultItemType: "Place",
          Place: { PlaceId: "label-only", Address: { Label: "Key Largo, FL, United States" } },
        },
        fullResult,
      ],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("Key Largo");
    expect(result.status === "ok" && result.suggestions.map((s) => s.id)).toEqual(["place-1"]);
  });
});
