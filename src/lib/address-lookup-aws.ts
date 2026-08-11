import { AutocompleteCommand, GeoPlacesClient } from "@aws-sdk/client-geo-places";
import {
  ADDRESS_SUGGESTION_LIMIT,
  type AddressLookupConfig,
  type AddressLookupProvider,
  type AddressLookupResult,
  classifyLookupError,
  hasAddressParts,
  isLookupWorthy,
  type PlaceSuggestion,
  toShopAddressFields,
} from "./address-lookup";
import { log } from "./log";

/**
 * Address suggestions from Amazon Location Service (ADR
 * 20260804-aws-location-address-lookup).
 *
 * Server-side, always. The SDK signs with SigV4 from credentials that live
 * only in the server's environment, so nothing here reaches the browser — which
 * is the whole reason this is a server action behind a session rather than the
 * usual browser-key autocomplete widget. There is no public key to leak, no
 * referrer allowlist to keep honest, and no way for a page to spend the shop's
 * geocoding budget without going through the app's own authorization first.
 *
 * `Autocomplete` (not `Suggest` or `Geocode`) because it is the one built for
 * a partial query typed a keystroke at a time, and it returns the structured
 * `Address` this needs — a suggestion the staffer picks fills the five boxes
 * outright rather than posting a display string that then has to be re-parsed.
 *
 * The SDK handles its own retry and backoff, so there is no request loop here.
 */
type GeoPlacesLike = { send: (command: AutocompleteCommand) => Promise<unknown> };

export function awsAddressLookupProvider(
  config: AddressLookupConfig,
  options: { client?: GeoPlacesLike } = {},
): AddressLookupProvider {
  const client: GeoPlacesLike =
    options.client ??
    new GeoPlacesClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

  return {
    async suggest(query: string): Promise<AddressLookupResult> {
      // Checked here as well as at the action, because "don't spend a billed
      // request on two characters" is a property of the lookup, not of one
      // caller's validation.
      if (!isLookupWorthy(query)) return { status: "too_short" };
      try {
        const response = (await client.send(
          new AutocompleteCommand({
            QueryText: query.trim(),
            MaxResults: ADDRESS_SUGGESTION_LIMIT,
            // Not optional, despite the name. `Autocomplete` returns only the
            // place id, place type and a one-line label by default — the
            // `Address` object comes back holding a `Label` and *nothing else*
            // unless `Core` is asked for ("`Address` contains the result label
            // and, if `["Core"]` is specified for `AdditionalFeatures`, it also
            // contains the full breakdown of the address into structured
            // fields", Amazon Location developer guide). Without it every
            // suggestion still reads correctly in the list and then fills the
            // five boxes with five empty strings when picked, because a pick
            // *replaces* the whole address — which is how "address lookup
            // doesn't work" was reported with the request succeeding every
            // time. The extra attributes are priced, which is the trade the
            // guide flags; a structured address is the entire point of the
            // control, so there is nothing to trade away.
            AdditionalFeatures: ["Core"],
          }),
        )) as {
          ResultItems?: {
            PlaceId?: string;
            Title?: string;
            Address?: {
              AddressNumber?: string;
              Street?: string;
              Locality?: string;
              District?: string;
              Region?: { Code?: string; Name?: string };
              PostalCode?: string;
              Country?: { Code2?: string };
            };
          }[];
        };
        const suggestions: PlaceSuggestion[] = (response.ResultItems ?? [])
          // A result with no id or nothing to read is not pickable; drop it
          // rather than render a blank row.
          .filter((item) => item.PlaceId && item.Title)
          .map((item) => ({
            id: item.PlaceId as string,
            label: item.Title as string,
            address: toShopAddressFields({
              streetNumber: item.Address?.AddressNumber,
              street: item.Address?.Street,
              // A place inside a big city often carries its neighbourhood as
              // `Locality` and the city as `District` — or the reverse. The
              // first non-empty of the two is the town a diver would post a
              // letter to, which is what this column is for.
              locality: item.Address?.Locality || item.Address?.District,
              // The short code where there is one ("FL"), which is what fits a
              // one-line address; the full name otherwise.
              region: item.Address?.Region?.Code || item.Address?.Region?.Name,
              postalCode: item.Address?.PostalCode,
              countryCode: item.Address?.Country?.Code2,
            }),
          }))
          // Braces to the `AdditionalFeatures` belt above: a pick *replaces*
          // the whole address, so a suggestion carrying no structured parts is
          // not a weaker answer — it is a trap that blanks all five boxes the
          // moment it is chosen. If a result ever comes back label-only again
          // (a provider change, a place type with no breakdown), it is dropped
          // rather than offered.
          .filter((suggestion) => hasAddressParts(suggestion.address));
        return { status: "ok", suggestions };
      } catch (error) {
        // A geocoder being down must never take the settings page with it: the
        // five boxes still work, and the staffer types the address.
        //
        // The error's **shape** is read, never its message or body: an AWS
        // error can echo the query back, and a partial address is the shop's
        // own business detail. A class name, a transport code and an HTTP
        // status are enough to tell the cases that matter apart — expired or
        // wrong-permission credentials (403 / AccessDeniedException), a region
        // where the Places API is not served (the host never resolves, so
        // there is no status at all), and throttling.
        //
        // Both halves of that go out: the classification travels back to the
        // caller so the failure names itself where a person is already looking,
        // and the raw shape is logged so a CloudWatch reader gets the AWS
        // vocabulary too. Only one of those two was here before, which is how a
        // reproducible outage stayed a question (FU-20260809).
        const shape = error as {
          name?: unknown;
          code?: unknown;
          $metadata?: { httpStatusCode?: unknown };
        };
        const name = typeof shape?.name === "string" ? shape.name : null;
        const code = typeof shape?.code === "string" ? shape.code : null;
        const status =
          typeof shape?.$metadata?.httpStatusCode === "number"
            ? shape.$metadata.httpStatusCode
            : null;
        const outcome = classifyLookupError({ name, code, status });
        log("address_lookup.failed", "warn", {
          error: name ?? "unknown",
          code,
          status,
          reason: outcome.status === "rate_limited" ? "throttled" : outcome.reason,
        });
        return outcome;
      }
    },
  };
}
