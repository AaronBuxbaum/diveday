# 20260804-aws-location-address-lookup — Look a shop's address up server-side, through Amazon Location

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

The settings address card is five free-text boxes (`shops.address_street`, `_locality`, `_region`,
`_postal_code`, `_country`). A shop filling them in by hand gets to invent its own spelling of its
own town, put the postcode in the region box, and write `USA` where the column wants `US`. That
address is not decorative: `src/lib/structured-data.ts` publishes it as the shop's `PostalAddress`,
which is how a search engine places the shop as a real venue, and the same fields render on the
public shop pages a diver navigates from. A typo there costs the shop reach and costs a diver a
wrong turn.

The obvious fix is the one every checkout form uses — a place type-ahead. The obvious *implementation*
is Google Places Autocomplete, which is a browser-side widget driven by a public,
referrer-restricted, billing-enabled API key. That shape has real costs here: a key in client
JavaScript that anyone can lift and spend against, a referrer allowlist that has to stay correct
across preview deployments and the embed origin, a `NEXT_PUBLIC_*` variable in a codebase that has
deliberately kept every credential server-side, and a third-party script loaded into a staff page
under a CSP that currently allows none.

The product owner's call was to use **AWS Location Service** instead. That choice is not merely
vendor preference: Location's `Autocomplete` is a plain signed AWS API, so it can be called from the
server, which removes the entire browser-key problem rather than managing it.

## Decision

- **A server action, never a browser key.** `suggestAddressAction` (in the settings `actions.ts`)
  takes the partial query, calls Amazon Location, and returns suggestions. The credentials never
  leave the server; there is no public key to leak, no referrer allowlist to keep honest, and no
  third-party script on the page.
- **`@aws-sdk/client-geo-places` joins `@aws-sdk/client-sesv2` and `@aws-sdk/client-sns`** as a third
  AWS-SDK exception to the no-SDK/fetch house style, for the reason those two give: correctly-tested
  SigV4 signing beats a hand-rolled crypto surface. It follows their adapter shape exactly —
  `awsAddressLookupProvider(config, { client })`, so a test injects `{ send: vi.fn() }` rather than a
  real client. The import is `await import(...)`ed inside the action, so a deployment with no
  credentials never loads the SDK at all.
- **`Autocomplete`, not `Suggest` or `Geocode`.** It is the operation built for a partial query typed
  a keystroke at a time, and it returns the structured `Address` the columns need — so picking a
  suggestion fills the five boxes outright rather than posting a display string that then has to be
  re-parsed.
- **Its own IAM user and its own `PLACES_AWS_*` key pair**, per the least-privilege split SES and SNS
  already established: this identity holds `geo-places:Autocomplete` and nothing else, so a
  geocoding key can never send mail and a mail key can never spend the geocoding budget.
- **Unconfigured is a supported state, not an error.** With no credentials the card renders exactly
  the five text boxes it has always been — no search box, nothing that looks broken. This is the
  ordinary local and self-hosted case, and `scripts/check-env.mjs` skips `PLACES_*` accordingly.
- **A pick replaces the whole address rather than merging into it.** `toShopAddressFields` returns
  every field, empty ones included, so a place with no postcode clears the postcode box. Half of one
  address and half of another is worse than either. The boxes stay editable afterwards.
- **Four guards on the action, each doing separate work:** the staff session; the live-checked
  `canManageShopSettings` gate (the action is reached only from a page a captain cannot open, so
  leaving it ungated would make it the way around that); a per-staff-member rate limit
  (`RATE_LIMITS.addressLookup`), because the billing risk is a type-ahead firing per keystroke as
  much as it is an attacker; and a length bound, so the box can never push a large body at a metered
  third-party API on the shop's account.

## Consequences

- Address suggestions cost a billed Amazon Location request per lookup, on DiveDay's account rather
  than each shop's. The debounce, the three-character minimum, and the rate limit bound that; the
  errand itself is rare (a shop sets its address roughly once).
- Suggestion text is third-party content rendered into React children and `value` attributes, where
  it is escaped by default. Nothing here uses `dangerouslySetInnerHTML`, and nothing should.
- The query is a partial business address and is deliberately never logged, including on the failure
  path — an AWS error body can echo it back.
- Amazon Location's coverage and its address-part conventions are not Google's. `Locality` and
  `District` are used inconsistently inside large cities, which the adapter handles by preferring the
  first non-empty of the two; other conventions may surface as shops outside the US start using it.
- A geocoder outage degrades to the five boxes with a note, never a broken page — the adapter
  swallows the error into `{ status: "failed", reason }`. The staffer reads one sentence whatever
  the reason is; the reason exists for whoever has to fix the deployment, and it travels back in the
  action's return value as well as into the log line. It is a category (`denied`, `unreachable`,
  `rejected`, `unknown`), never the provider's message — an AWS error can echo the query.
- Amazon Location `Autocomplete` is unavailable in `ap-southeast-1` and `ap-southeast-5` for GrabMaps
  customers; `PLACES_AWS_REGION` must not be set to one of those. More generally the Places API is
  not served in every AWS region, and the SDK has no ruleset check behind it — it composes
  `geo-places.<region>.amazonaws.com` from whatever string it is given, so a region that does not
  serve the API fails in DNS on every keystroke with no HTTP status and no AWS exception name. The
  stack therefore sets `PLACES_AWS_REGION` from a **named** constant (§12) rather than from
  `this.region` the way the SES, SNS and CloudWatch credentials do: those services are served
  everywhere, so inheriting the deployer's region is harmless for them and a silent trap here.
- The provider's own throttle (`ThrottlingException`, HTTP 429) resolves to `rate_limited`, the same
  temporary "resting" state as DiveDay's per-staffer limiter, rather than to `failed`. It is the
  identical fact — the budget is spent, wait — and reporting it as a dead end is what the
  `rate_limited` state was split out to stop.
- `Autocomplete` returns only a place id, a place type and a one-line label unless the request asks
  for `AdditionalFeatures: ["Core"]`; the `Address` object comes back carrying a `Label` and no
  structured fields. The adapter always asks for `Core`, and the extra attributes are priced. This
  is the one request parameter the feature cannot work without — a response missing it looks
  entirely healthy (real places, right order, no error) and then writes five empty strings into the
  shop's address, because a pick replaces every column. Shipped without it, which is how the lookup
  was reported as broken while every request succeeded (2026-08-09).

## Alternatives considered

- **Google Places Autocomplete (the browser widget).** The obvious choice, and what the request
  originally named. Rejected on shape rather than quality: it needs a public `NEXT_PUBLIC_*` API key
  in client JavaScript, a referrer allowlist kept correct across every preview deployment and the
  embed origin, a third-party script under a CSP that currently allows none, and it puts a spendable
  credential in every visitor's browser. Every one of those problems is created by the widget being
  client-side, and disappears when the lookup is a server call.
- **Google Places, called server-side.** Keeps the credential on the server, so it solves the key
  problem — but it adds a second cloud vendor's billing, IAM, and quota surface to a codebase that
  already has AWS credentials, IAM conventions, and cost alarms stood up for SES and SNS. Amazon
  Location is the same posture, one account, one bill.
- **A static country/region dataset, no geocoder.** No vendor, no cost, no key. It would fix the
  country code and the region list — the two most-mangled fields — and nothing else: the street and
  locality, which are what a diver actually navigates by, would stay free text. Worth revisiting as
  a *complement* if lookup volume ever justifies trimming it.
- **Validate on save instead of suggesting while typing.** Cheaper (one request per save, not per
  query) but strictly worse at the job: it can tell a shop its address is wrong without being able to
  say what the right one is, which turns a two-second pick into a guessing loop.
- **Leave it as five text boxes.** The status quo, and genuinely defensible — a shop sets its address
  once. Rejected because the address is published as structured data rather than merely stored, so
  its errors are silent and long-lived: nobody at the shop ever sees the wrong `PostalAddress`, and
  the diver who does is already lost.
