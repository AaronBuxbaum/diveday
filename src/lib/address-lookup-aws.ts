import { AutocompleteCommand, GeoPlacesClient } from "@aws-sdk/client-geo-places";
import {
  ADDRESS_SUGGESTION_LIMIT,
  type AddressLookupConfig,
  type AddressLookupProvider,
  type AddressLookupResult,
  isLookupWorthy,
  type PlaceSuggestion,
  toShopAddressFields,
} from "./address-lookup";

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
          }));
        return { status: "ok", suggestions };
      } catch {
        // A geocoder being down must never take the settings page with it: the
        // five boxes still work, and the staffer types the address. The error
        // body can echo the query back, so it is deliberately not logged —
        // a partial address is the shop's own business detail.
        return { status: "failed" };
      }
    },
  };
}
