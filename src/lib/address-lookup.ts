/**
 * Looking a shop's address up instead of typing it.
 *
 * The settings address card is five free-text boxes, and a shop filling them in
 * by hand gets to invent its own spelling of its own town, put the postcode in
 * the region box, and write "USA" where the column wants `US`. That address is
 * published — it feeds the structured data search engines read the shop's
 * venue from — so the cost of a typo is not cosmetic.
 *
 * This module is the provider-neutral half: the shape of a suggestion, what
 * counts as a query worth spending a billed request on, and how a looked-up
 * place folds into the five columns. It knows nothing about AWS, HTTP, or
 * React. The adapter lives in `./address-lookup-aws.ts`, behind
 * {@link AddressLookupProvider}, and is imported lazily so an unconfigured
 * deployment never loads an SDK it will not call.
 *
 * Codes and fragments only, never sentences (AGENTS.md: `src/lib` returns
 * codes; the UI picks the words).
 */

/** The five address columns on `shops`, as one value the form round-trips. */
export type ShopAddressFields = {
  addressStreet: string;
  addressLocality: string;
  addressRegion: string;
  addressPostalCode: string;
  /** ISO 3166-1 **alpha-2**, which is what the column stores and schema.org wants. */
  addressCountry: string;
};

/** One row a staffer can pick from the type-ahead. */
export type PlaceSuggestion = {
  /** The provider's opaque id — never stored, only a React key. */
  id: string;
  /** The provider's own one-line rendering, which is what the staffer reads. */
  label: string;
  /** The parts that land in the five boxes when this row is picked. */
  address: ShopAddressFields;
};

/**
 * The shortest query worth sending. One or two characters match most of a
 * country and cost a billed request per keystroke to say so.
 */
export const MIN_ADDRESS_QUERY_LENGTH = 3;

/**
 * The longest query accepted. Comfortably past any real address, and short
 * enough that the box can never be used to push a large body at a metered
 * third-party API on the shop's own account.
 */
export const MAX_ADDRESS_QUERY_LENGTH = 200;

/** How many suggestions to ask for — a pickable list, not a catalogue. */
export const ADDRESS_SUGGESTION_LIMIT = 5;

/** Whether a typed query is worth a billed lookup at all. */
export function isLookupWorthy(query: string): boolean {
  const length = query.trim().length;
  return length >= MIN_ADDRESS_QUERY_LENGTH && length <= MAX_ADDRESS_QUERY_LENGTH;
}

/**
 * A structured address from a geocoder, in the shape every provider agrees on.
 * Named for what it means, not for whose API it came from.
 */
export type LookedUpAddress = {
  streetNumber?: string | null;
  street?: string | null;
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

/**
 * A looked-up place folded into the five columns.
 *
 * Street number and street name arrive separately and are stored as one line,
 * because that is what the column is and what a diver reads on a business card.
 *
 * Every field falls back to empty rather than being omitted: picking a
 * suggestion must *replace* the whole address, not merge into it. A place with
 * no postcode has to clear the postcode box, or the shop is left holding half
 * of one address and half of another — which is worse than either.
 *
 * The country is normalized to upper-case alpha-2, which is what the settings
 * schema caps at two characters and what the structured data publishes.
 */
export function toShopAddressFields(parts: LookedUpAddress): ShopAddressFields {
  const street = [parts.streetNumber, parts.street]
    .map((piece) => piece?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return {
    addressStreet: street,
    addressLocality: parts.locality?.trim() ?? "",
    addressRegion: parts.region?.trim() ?? "",
    addressPostalCode: parts.postalCode?.trim() ?? "",
    addressCountry: (parts.countryCode ?? "").trim().slice(0, 2).toUpperCase(),
  };
}

/**
 * The result of asking for suggestions. `not_configured` is a first-class
 * answer, not an error: a deployment with no geocoder credentials is the
 * ordinary local and self-hosted case, and the card falls back to the plain
 * boxes it has always been rather than showing a broken control.
 */
export type AddressLookupResult =
  | { status: "ok"; suggestions: PlaceSuggestion[] }
  | { status: "not_configured" }
  | { status: "too_short" }
  | { status: "failed" };

export type AddressLookupProvider = {
  suggest(query: string): Promise<AddressLookupResult>;
};

export type AddressLookupConfig = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Credentials for the lookup, or null when the deployment has none.
 *
 * Its own key pair rather than the SES/SNS ones (`SES_AWS_*`, `SNS_AWS_*`),
 * following the same per-service split those already established: the IAM user
 * behind this needs exactly `geo-places:Autocomplete` and nothing else, and
 * sharing a key would hand a mail sender a geocoding budget and vice versa.
 */
export function addressLookupConfigFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): AddressLookupConfig | null {
  const region = env.PLACES_AWS_REGION?.trim();
  const accessKeyId = env.PLACES_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.PLACES_AWS_SECRET_ACCESS_KEY?.trim();
  if (!region || !accessKeyId || !secretAccessKey) return null;
  return { region, accessKeyId, secretAccessKey };
}

/** Whether this deployment can look an address up at all. */
export function isAddressLookupConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return addressLookupConfigFromEnvironment(env) !== null;
}
