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

  /**
   * The production bug this replaces, and the reason it is written as a range
   * rather than as an equality.
   *
   * The adapter shipped `MaxQueryRefinements: 0` — "don't offer me query
   * refinements" — and AWS documents that parameter's valid range as **1..10**.
   * Every keystroke came back `ValidationException` / HTTP 400, so the box
   * found nothing at all. The test that was here asserted `MaxQueryRefinements
   * === 0` and passed the whole time: a mocked client accepts any request
   * object, so an assertion that the adapter sends what the adapter sends
   * proves only that, never that AWS would take it.
   *
   * So the assertion is now against the *documented constraint* instead of
   * against the code's own choice. That is the only shape of request test a
   * fake client can be wrong about in a useful direction.
   */
  it("sends no request parameter outside the range AWS documents for it", async () => {
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef Dive Center");
    const input = (client.send.mock.calls[0][0] as { input: Record<string, unknown> }).input;

    // MaxResults: "Valid Range: Minimum value of 1. Maximum value of 100."
    expect(input.MaxResults).toBeGreaterThanOrEqual(1);
    expect(input.MaxResults).toBeLessThanOrEqual(100);
    // QueryText: "Length Constraints: Minimum length of 1. Maximum length of 200."
    expect(String(input.QueryText).length).toBeGreaterThanOrEqual(1);
    expect(String(input.QueryText).length).toBeLessThanOrEqual(200);
    // AdditionalFeatures: "Minimum number of 1 item. Maximum number of 5 items."
    expect((input.AdditionalFeatures as string[]).length).toBeGreaterThanOrEqual(1);
    expect((input.AdditionalFeatures as string[]).length).toBeLessThanOrEqual(5);
    // MaxQueryRefinements: "Valid Range: Minimum value of 1. Maximum value of
    // 10." Sending it at all buys nothing — refinements arrive in their own
    // `QueryRefinements` array, which this adapter never reads — so the
    // in-range value to send is no value.
    expect(input.MaxQueryRefinements).toBeUndefined();
  });

  /**
   * The second production failure of the evening, and the reason these two are
   * written as "one of the pair, never neither".
   *
   * `Suggest` refuses a request carrying no geographic anchor: with none of
   * `BiasPosition`, `Filter.BoundingBox` or `Filter.Circle` set it answers
   * `ValidationException` naming exactly those three — every one of which the
   * API reference marks "Required: No". Nothing in the published constraints
   * says this; only the field list in the error does.
   */
  it("ranks around the shop's own water when it knows where that is", async () => {
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef", {
      longitude: -80.4,
      latitude: 25.0117,
    });
    const input = (client.send.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    // `[lng, lat]`, in that order — the reverse is a valid pair of numbers and
    // a different hemisphere.
    expect(input.BiasPosition).toEqual([-80.4, 25.0117]);
    // Mutually exclusive with the bias, so exactly one of them travels.
    expect(input.Filter).toBeUndefined();
  });

  it("searches the whole globe rather than nowhere when it has no anchor", async () => {
    // A brand-new shop has no dive sites, so there is no honest centre to pick
    // — and sending nothing is the one thing AWS refuses outright.
    const client = clientReturning({ ResultItems: [] });
    await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef");
    const input = (client.send.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(input.BiasPosition).toBeUndefined();
    expect(input.Filter).toEqual({ BoundingBox: [-180, -90, 180, 90] });
  });

  it("always sends one of the two anchors, whether or not it has a position", async () => {
    // The invariant the field list in that ValidationException named. Asserted
    // over both paths at once so neither can lose its anchor alone.
    for (const bias of [null, { longitude: -80.4, latitude: 25.0117 }]) {
      const client = clientReturning({ ResultItems: [] });
      await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef", bias);
      const input = (client.send.mock.calls[0][0] as { input: Record<string, unknown> }).input;
      const anchors = [
        input.BiasPosition,
        (input.Filter as { BoundingBox?: unknown })?.BoundingBox,
        (input.Filter as { Circle?: unknown })?.Circle,
      ].filter((anchor) => anchor !== undefined);
      expect(anchors).toHaveLength(1);
    }
  });

  it("never spends a request the query is too long for", async () => {
    // The 200-character bound above is AWS's own `QueryText` limit, so a query
    // past it is a guaranteed `ValidationException` rather than a big bill.
    const client = clientReturning({ ResultItems: [] });
    const result = await awsAddressLookupProvider(config, { client }).suggest("x".repeat(201));
    expect(result).toEqual({ status: "too_short" });
    expect(client.send).not.toHaveBeenCalled();
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

  it("names the request field AWS refused, so a malformed request isn't just 'rejected'", async () => {
    // What `MaxQueryRefinements: 0` looked like in production: a flat
    // `"reason":"rejected"` with nothing to act on, identical to every other
    // malformed request. The field name is the whole fix.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = Object.assign(new Error("1 validation error detected"), {
      name: "ValidationException",
      Reason: "FieldValidationFailed",
      FieldList: [
        { Name: "MaxQueryRefinements", Message: "Member must be greater than or equal to 1" },
      ],
      $metadata: { httpStatusCode: 400 },
    });
    const client = { send: vi.fn().mockRejectedValue(invalid) };
    await awsAddressLookupProvider(config, { client }).suggest("Rainbow Reef");

    const line = warn.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain("FieldValidationFailed");
    expect(line).toContain("MaxQueryRefinements");
    warn.mockRestore();
  });

  it("logs the refused field's name but never AWS's message about it", async () => {
    // `Message` is prose AWS composes around the value it rejected, and for
    // `QueryText` that value is the shop's partly-typed business address.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = Object.assign(new Error("1 validation error detected"), {
      name: "ValidationException",
      Reason: "FieldValidationFailed",
      FieldList: [{ Name: "QueryText", Message: "Invalid value: 102 Ocean Drive, Key Largo" }],
      $metadata: { httpStatusCode: 400 },
    });
    const client = { send: vi.fn().mockRejectedValue(invalid) };
    await awsAddressLookupProvider(config, { client }).suggest("102 Ocean Drive");

    const line = warn.mock.calls.at(-1)?.[0] as string;
    expect(line).toContain("QueryText");
    expect(line).not.toContain("Ocean");
    warn.mockRestore();
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
