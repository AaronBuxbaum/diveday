import { describe, expect, it, vi } from "vitest";
import { awsAddressLookupProvider } from "./address-lookup-aws";

const config = { region: "us-east-1", accessKeyId: "AKIA_EXAMPLE", secretAccessKey: "secret" };

/** A client that answers every send with one canned response. */
function clientReturning(response: unknown) {
  return { send: vi.fn().mockResolvedValue(response) };
}

const fullResult = {
  PlaceId: "place-1",
  Title: "102 Ocean Drive, Key Largo, FL 33037, United States",
  Address: {
    AddressNumber: "102",
    Street: "Ocean Drive",
    Locality: "Key Largo",
    Region: { Code: "FL", Name: "Florida" },
    PostalCode: "33037",
    Country: { Code2: "US" },
  },
};

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

  it("prefers the short region code, which is what fits a one-line address", async () => {
    const client = clientReturning({
      ResultItems: [
        { ...fullResult, Address: { ...fullResult.Address, Region: { Name: "Florida" } } },
      ],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result.status === "ok" && result.suggestions[0].address.addressRegion).toBe("Florida");
  });

  it("falls back to the district when a place carries no locality", async () => {
    // Inside a big city the town a diver would post a letter to often lands in
    // `District` rather than `Locality`.
    const client = clientReturning({
      ResultItems: [
        {
          ...fullResult,
          Address: { ...fullResult.Address, Locality: undefined, District: "Brooklyn" },
        },
      ],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result.status === "ok" && result.suggestions[0].address.addressLocality).toBe(
      "Brooklyn",
    );
  });

  it("drops a result with nothing to key or read, rather than rendering a blank row", async () => {
    const client = clientReturning({
      ResultItems: [
        { PlaceId: undefined, Title: "no id" },
        { PlaceId: "p", Title: undefined },
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
    // the five boxes still work and the staffer types the address.
    const client = { send: vi.fn().mockRejectedValue(new Error("ThrottlingException")) };
    const result = await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    expect(result).toEqual({ status: "failed" });
  });

  it("asks for a pickable list, not a catalogue, and sends the trimmed query", async () => {
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("  102 Ocean  ");
    const command = client.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.QueryText).toBe("102 Ocean");
    expect(command.input.MaxResults).toBe(5);
  });

  it("asks for the structured address breakdown, which Autocomplete withholds by default", async () => {
    // The regression this file missed for a release: `Autocomplete` returns
    // the place id, the place type and a one-line label unless
    // `AdditionalFeatures: ["Core"]` is asked for, and every test above hands
    // the adapter a response that already has an `Address` on it — so the
    // mapping was proven while the request that earns the mapping was not.
    // Without this the lookup succeeds, lists real places, and fills the
    // shop's five boxes with five empty strings.
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("102 Ocean");
    const command = client.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.AdditionalFeatures).toEqual(["Core"]);
  });

  it("drops a label-only result rather than offering one that blanks the address", async () => {
    // What a response looks like when the breakdown is missing: readable in the
    // list, and five empty boxes the moment it is picked, because a pick
    // replaces the whole address.
    const client = clientReturning({
      ResultItems: [
        {
          PlaceId: "label-only",
          Title: "Key Largo, FL, United States",
          Address: { Label: "Key Largo, FL, United States" },
        },
        fullResult,
      ],
    });
    const result = await awsAddressLookupProvider(config, { client }).suggest("Key Largo");
    expect(result.status === "ok" && result.suggestions.map((s) => s.id)).toEqual(["place-1"]);
  });
});
