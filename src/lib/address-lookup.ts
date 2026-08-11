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
 * Whether a folded address carries anything at all.
 *
 * Picking a suggestion replaces every one of the five columns, so an address
 * with no parts in it is not a thin answer — it is one that empties the boxes
 * the shop already filled in. Adapters use this to drop such a result instead
 * of offering it.
 */
export function hasAddressParts(address: ShopAddressFields): boolean {
  return Object.values(address).some((value) => value.length > 0);
}

/**
 * Why a lookup failed, in the only detail coarse enough to hand to a browser.
 *
 * `failed` used to be one opaque word. A deployment holding a credential the
 * geocoder rejects, one whose IAM policy is missing the operation, and one
 * pointed at a region that does not serve the API all produced exactly that
 * word — identical in the box, identical in the network panel, and separable
 * only from a CloudWatch line that nobody reporting the bug can read. So a
 * reproducible outage sat open as a question for days (FU-20260809), and a
 * second report of it arrived carrying the response body `{"status":"failed"}`
 * and no way to act on it.
 *
 * These are **categories**, never the provider's own message: an AWS error can
 * echo the query back, and the query is a partial business address. A category,
 * a transport code and an HTTP status say which of the three cases it is
 * without repeating anything the shop typed.
 *
 * The words a staffer reads do not change with the reason — the boxes below
 * still work and the address still gets typed, which is the only thing the
 * screen has to say. This is for whoever has to fix the deployment.
 */
export type AddressLookupFailureReason =
  /** The actor no longer holds the settings gate. Nothing to do with the geocoder. */
  | "not_permitted"
  /** Credentials rejected, expired, or missing `geo-places:Autocomplete`. */
  | "denied"
  /** No answer came back at all — most often a region that does not serve the API. */
  | "unreachable"
  /** The provider understood the request and refused it. */
  | "rejected"
  /** Anything else, including the provider's own 5xx. */
  | "unknown";

/**
 * The result of asking for suggestions. `not_configured` is a first-class
 * answer, not an error: a deployment with no geocoder credentials is the
 * ordinary local and self-hosted case, and the card falls back to the plain
 * boxes it has always been rather than showing a broken control.
 *
 * `rate_limited` is its own answer for the same reason. It used to collapse
 * into `failed`, so a staffer who had simply spent the hour's request budget
 * read "address lookup isn't available right now" — the same sentence a dead
 * geocoder shows — and concluded the feature was broken rather than resting.
 * That is the state a shop most often meets it in: the budget is per hour and
 * a single hesitant typist can walk through a good share of it.
 */
export type AddressLookupResult =
  | { status: "ok"; suggestions: PlaceSuggestion[] }
  | { status: "not_configured" }
  | { status: "too_short" }
  | { status: "rate_limited" }
  | { status: "failed"; reason: AddressLookupFailureReason };

/** What an adapter can read off a thrown provider error without reading its message. */
export type LookupErrorShape = {
  /** The exception's class name, e.g. `AccessDeniedException`. */
  name?: string | null;
  /** A transport-level code, e.g. `ENOTFOUND` when a region resolves to nothing. */
  code?: string | null;
  /** The HTTP status the provider answered with, or null when nothing answered. */
  status?: number | null;
};

/** Names and codes that mean "the provider is asking us to slow down". */
const THROTTLE_PATTERN = /throttl|toomanyrequests|requestlimitexceeded|slowdown/i;

/**
 * Names that mean the credential itself was refused — wrong key, expired key,
 * or a key whose policy does not carry the operation.
 */
const DENIED_PATTERN =
  /accessdenied|unrecognizedclient|invalidsignature|incompletesignature|missingauthentication|expiredtoken|invalidclienttokenid|authfailure|unauthorized|notauthorized/i;

/**
 * Transport codes that mean nothing ever answered. A region that does not serve
 * the API is the loud case: the SDK builds a host out of the region name, and a
 * name no such host exists for fails here rather than at any HTTP status.
 */
const UNREACHABLE_PATTERN =
  /enotfound|eai_again|econnrefused|econnreset|etimedout|epipe|timeouterror|networkingerror|unknownendpoint|networkerror/i;

/**
 * A thrown provider error, sorted into what a person can act on.
 *
 * Provider-neutral on purpose: it takes the three facts every SDK exposes
 * rather than an AWS error, so the adapter stays the only file that knows whose
 * geocoder this is.
 *
 * Throttling comes back as `rate_limited`, not as a failure. The app already
 * has a temporary, self-healing state with its own sentence for exactly this —
 * it was just wired only to DiveDay's own per-staffer limiter, so the
 * provider's identical answer arrived as the dead-end "not available right
 * now" the state exists to avoid.
 */
export function classifyLookupError(
  shape: LookupErrorShape,
): { status: "rate_limited" } | { status: "failed"; reason: AddressLookupFailureReason } {
  const name = shape.name ?? "";
  const code = shape.code ?? "";
  const status = shape.status ?? null;
  const signature = `${name} ${code}`;

  if (status === 429 || THROTTLE_PATTERN.test(signature)) return { status: "rate_limited" };
  if (status === 401 || status === 403 || DENIED_PATTERN.test(signature)) {
    return { status: "failed", reason: "denied" };
  }
  // A transport code only counts when nothing answered: a provider may attach
  // one to a perfectly ordinary refusal.
  if (status === null && UNREACHABLE_PATTERN.test(signature)) {
    return { status: "failed", reason: "unreachable" };
  }
  if (status !== null && status >= 400 && status < 500) {
    return { status: "failed", reason: "rejected" };
  }
  return { status: "failed", reason: "unknown" };
}

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
