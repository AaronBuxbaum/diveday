import { GeoPlacesClient, SuggestCommand } from "@aws-sdk/client-geo-places";
import {
  ADDRESS_SUGGESTION_LIMIT,
  type AddressLookupConfig,
  type AddressLookupProvider,
  type AddressLookupResult,
  classifyLookupError,
  hasAddressParts,
  isLookupWorthy,
  type LookupContext,
  type PlaceSuggestion,
  toShopAddressFields,
  WORLD_BOUNDING_BOX,
} from "./address-lookup";
import { log } from "./log";

/**
 * Address suggestions from Amazon Location Service (ADR
 * 20260804-aws-location-address-lookup, amended by ADR
 * 20260811-address-is-one-search-box).
 *
 * Server-side, always. The SDK signs with SigV4 from credentials that live
 * only in the server's environment, so nothing here reaches the browser — which
 * is the whole reason this is a server action behind a session rather than the
 * usual browser-key autocomplete widget. There is no public key to leak, no
 * referrer allowlist to keep honest, and no way for a page to spend the shop's
 * geocoding budget without going through the app's own authorization first.
 *
 * **`Suggest`, not `Autocomplete`.** This shipped on `Autocomplete` and was
 * reported as "the search works but never finds my shop by name", which is
 * exactly what that operation does: it "completes partial queries with valid
 * address *completion*" (AWS SDK docs), so it answers streets and it does not
 * answer businesses. `Suggest` is the one that returns "relevant places, points
 * of interest" — a dive shop typing its own name is the query this card exists
 * to serve, because a shop owner recalls "Rainbow Reef Dive Center" instantly
 * and their own postcode slowly. Both take a partial query typed a keystroke at
 * a time and both return the structured `Address` the columns need, so nothing
 * about the debounce, the guards, or the mapping changes with the swap; only
 * the class of thing that can be found does.
 *
 * The SDK handles its own retry and backoff, so there is no request loop here.
 */
type GeoPlacesLike = { send: (command: SuggestCommand) => Promise<unknown> };

/**
 * The nameable half of a `ValidationException`, or null when the error is not
 * one.
 *
 * Field **names** and the `Reason` enum only. AWS's per-field `Message` is
 * prose it composes around the value it rejected, which for `QueryText` is the
 * shop's partially-typed business address — the one thing this module's log
 * line is not allowed to carry (ADR 20260804-aws-location-address-lookup).
 * The names are strings this file chose, so they give up nothing.
 */
function validationDetail(reason: unknown, fieldList: unknown): string | null {
  const fields = Array.isArray(fieldList)
    ? fieldList
        .map((field) => (field as { Name?: unknown })?.Name)
        .filter((fieldName): fieldName is string => typeof fieldName === "string")
    : [];
  const why = typeof reason === "string" ? reason : null;
  if (!why && fields.length === 0) return null;
  return [why, fields.join(",")].filter(Boolean).join(" ");
}

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
    async suggest(query: string, context: LookupContext = {}): Promise<AddressLookupResult> {
      const { bias, country } = context;
      // `IncludeCountries` lives inside the same `Filter` object as the
      // whole-globe box, so the two have to be assembled together rather than
      // spread independently — and it is *not* one of the mutually exclusive
      // anchors, so it may ride with a `BiasPosition` (Amazon Location's own
      // guide shows that pair).
      const filter = {
        ...(bias ? {} : { BoundingBox: [...WORLD_BOUNDING_BOX] }),
        ...(country ? { IncludeCountries: [country] } : {}),
      };
      // Checked here as well as at the action, because "don't spend a billed
      // request on two characters" is a property of the lookup, not of one
      // caller's validation.
      if (!isLookupWorthy(query)) return { status: "too_short" };
      try {
        const response = (await client.send(
          new SuggestCommand({
            QueryText: query.trim(),
            // **One of these two, always — never neither.** `Suggest` refuses a
            // request carrying no geographic anchor, answering
            // `ValidationException` with a field list of exactly
            // `BiasPosition, Filter.BoundingBox, Filter.Circle` — all three of
            // which the API reference marks "Required: No" (2026-08-11, in
            // production, twice in one evening). They are also mutually
            // exclusive, so this is a choice and never both.
            //
            // A known position is the better anchor by far: it only *ranks*,
            // so it puts the shop's own street above an identically-named
            // place on another coast. The whole-globe box is what a shop with
            // nothing to anchor on gets — see `WORLD_BOUNDING_BOX`.
            ...(bias ? { BiasPosition: [bias.longitude, bias.latitude] } : {}),
            ...(Object.keys(filter).length > 0 ? { Filter: filter } : {}),
            // 1..100 per the API reference. Every request parameter here is
            // inside its documented range, and that is not a free-form style
            // note: AWS answers an out-of-range value with a flat
            // `ValidationException`, so the whole feature is dead until it is
            // spotted. See `MaxQueryRefinements` immediately below.
            MaxResults: ADDRESS_SUGGESTION_LIMIT,
            // **`MaxQueryRefinements` is deliberately not sent.** It shipped as
            // `0`, meaning "don't offer me query refinements", and its
            // documented range is 1..10 — so every keystroke came back
            // `ValidationException` / HTTP 400 and the box found nothing at
            // all (2026-08-11, in production). A mocked client cannot catch
            // that: it accepts any request object, so the test asserting `0`
            // passed while proving only that the adapter sends what the
            // adapter sends.
            //
            // Omitting it also costs nothing, because it never did the job it
            // was added for. Refinements come back in their own top-level
            // `QueryRefinements` array — suggested *search terms*, which this
            // adapter never reads — not as rows inside `ResultItems`. What
            // keeps an unpickable row out of the list is the `Place.PlaceId`
            // filter in the mapping below, which is where it belonged all
            // along.

            // Not optional, despite the name. The `Address` object comes back
            // holding a `Label` and *nothing else* unless `Core` is asked for
            // ("`Address` contains the result label and, if `["Core"]` is
            // specified for `AdditionalFeatures`, it also contains the full
            // breakdown of the address into structured fields", Amazon Location
            // developer guide). Without it every suggestion still reads
            // correctly in the list and then saves five empty strings when
            // picked, because a pick *replaces* the whole address — which is how
            // "address lookup doesn't work" was reported with the request
            // succeeding every time. The extra attributes are priced; a
            // structured address is the entire point of the control, so there is
            // nothing to trade away.
            AdditionalFeatures: ["Core"],
          }),
        )) as {
          ResultItems?: {
            Title?: string;
            SuggestResultItemType?: string;
            Place?: {
              PlaceId?: string;
              Address?: {
                Label?: string;
                AddressNumber?: string;
                Street?: string;
                Locality?: string;
                District?: string;
                Region?: { Code?: string; Name?: string };
                PostalCode?: string;
                Country?: { Code2?: string };
              };
            };
          }[];
        };
        const suggestions: PlaceSuggestion[] = (response.ResultItems ?? []).flatMap((item) => {
          const place = item.Place;
          // A row with no place behind it (a query refinement that slipped
          // through) or nothing to read is not pickable; drop it rather than
          // render a blank row.
          if (!place?.PlaceId || !item.Title) return [];
          const address = toShopAddressFields({
            streetNumber: place.Address?.AddressNumber,
            street: place.Address?.Street,
            // A place inside a big city often carries its neighbourhood as
            // `Locality` and the city as `District` — or the reverse. The
            // first non-empty of the two is the town a diver would post a
            // letter to, which is what this column is for.
            locality: place.Address?.Locality || place.Address?.District,
            // The short code where there is one ("FL"), which is what fits a
            // one-line address; the full name otherwise.
            region: place.Address?.Region?.Code || place.Address?.Region?.Name,
            postalCode: place.Address?.PostalCode,
            countryCode: place.Address?.Country?.Code2,
          });
          // Braces to the `AdditionalFeatures` belt above: a pick *replaces* the
          // whole address and saves it, so a suggestion carrying no structured
          // parts is not a weaker answer — it is a trap that wipes the shop's
          // address the moment it is chosen. If a result ever comes back
          // label-only again (a provider change, a place type with no
          // breakdown), it is dropped rather than offered.
          if (!hasAddressParts(address)) return [];
          // For a business, `Title` is its name and the label is its street —
          // two different facts, and the second is what separates one franchise
          // location from the next. For a plain address result the two are the
          // same string, and repeating it under itself would be noise.
          const label = place.Address?.Label?.trim();
          return [
            {
              id: place.PlaceId,
              label: item.Title,
              detail: label && label !== item.Title ? label : undefined,
              address,
            },
          ];
        });
        return { status: "ok", suggestions };
      } catch (error) {
        // A geocoder being down must never take the settings page with it: the
        // card says so, and the shop's stored address is left alone.
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
          Reason?: unknown;
          FieldList?: unknown;
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
          // Which *field* AWS refused, and why, when it says so. A
          // `ValidationException` carries a `Reason` enum
          // (`FieldValidationFailed`, `UnknownField`, …) and a `FieldList` of
          // `{ Name, Message }`, and only those two travel: `Name` is a
          // request-parameter name we chose ourselves and `Reason` is a
          // closed set, while `Message` is prose AWS composes and is exactly
          // where a rejected `QueryText` gets echoed back — the one thing this
          // log may never carry.
          //
          // Added because a bare `"reason":"rejected"` is what a wrong
          // `MaxQueryRefinements` looked like from the outside, and it is
          // indistinguishable from every other malformed request. One field
          // name would have turned that into a one-line fix.
          validation: validationDetail(shape.Reason, shape.FieldList),
        });
        return outcome;
      }
    },
  };
}
