# 20260811-address-is-one-search-box — The shop address is one search box, and picking is saving

- **Status:** Accepted
- **Date:** 2026-08-11
- **Amends:** [20260804-aws-location-address-lookup](20260804-aws-location-address-lookup.md)

## Context

ADR 20260804 put a place type-ahead on top of the settings address card and left the five free-text
boxes (`shops.address_street`, `_locality`, `_region`, `_postal_code`, `_country`) underneath it,
editable, with a Save button below them. The lookup existed because those boxes let a shop invent its
own spelling of its own town, put the postcode in the region box, and write `USA` where the column
wants `US` — and that address is published as the shop's `PostalAddress`, so its errors are silent
and long-lived.

Two things about that shape turned out to be wrong in use.

**The search could not find a shop.** It was built on Amazon Location's `Autocomplete`, which the AWS
SDK documents as completing "partial queries with valid address *completion*" — streets, not places.
A shop owner typing "Rainbow Reef Dive Center" got a search box that worked perfectly and never found
them. That is not a corner case: a shop recalls its own name instantly and its own postcode slowly,
so the name is the query the card most needs to answer, and it was the one query it could not.

**Keeping the boxes kept the problem.** With the lookup as a convenience layer over five editable
boxes, every mangled address the ADR set out to prevent was still one keystroke away, and the Save
button sat between the shop and a place it had already picked out of a list — a step that can only
be forgotten, never usefully reconsidered.

## Decision

- **`Suggest`, not `Autocomplete`.** ADR 20260804 chose `Autocomplete` for being "the operation built
  for a partial query typed a keystroke at a time". Both are; only `Suggest` returns "relevant
  places, points of interest". Everything else about the call is unchanged — same client, same
  `AdditionalFeatures: ["Core"]`, same guards, same debounce, same structured `Address` mapping — so
  the swap changes only the *class of thing that can be found*.
- **No `MaxQueryRefinements`.** This ADR originally recorded `MaxQueryRefinements: 0` here, on the
  reasoning that `Suggest` "also answers with search terms to try next, and a row with no place
  behind it has nothing to save". Both halves were wrong, and the first was wrong in production: the
  parameter's documented range is **1..10**, so `0` made every keystroke a `ValidationException` /
  HTTP 400 and the box found nothing at all. The second half is why nothing is sent in its place —
  query refinements arrive in their own top-level `QueryRefinements` array, which this adapter never
  reads, not as rows inside `ResultItems`. What keeps an unpickable row out of the list is the
  `Place.PlaceId` filter in the mapping. Every request parameter is asserted to be inside AWS's
  documented range, against the reference rather than against the code's own choice.
- **The IAM user holds `geo-places:Suggest` and nothing else** (infra §12), keeping the
  one-operation boundary 20260804 established. A stack still holding the old `Autocomplete` statement
  answers every keystroke with `AccessDeniedException`, so `cdk deploy` lands with or before the app
  release. Widening early is safe; nothing else calls `Autocomplete`.
- **Every request carries a geographic anchor, and the shop's own dive sites are it.** `Suggest`
  refuses a request with none of `BiasPosition` / `Filter.BoundingBox` / `Filter.Circle` —
  `ValidationException` naming exactly those three, all of which the API reference marks
  "Required: No". They are mutually exclusive, so it is one of them, never both. The anchor is
  `shopSearchAnchor` (`src/db/dive-sites.ts`): the forecast coordinate of the shop's
  alphabetically-first sited dive site, which is the only lat/lng this app stores for a shop and a
  good one — a storefront is near the water it takes people to. A bias only *ranks*, so this puts
  the shop's own street above an identically-named place on another coast rather than excluding
  anything. A shop with no sited water yet gets `WORLD_BOUNDING_BOX` instead of an invented centre.
  Ordered by name so the anchor cannot wobble between keystrokes and reshuffle a list mid-read.
- **A suggestion shows the place's name with its address beneath it.** For a business those are two
  different facts, and the second is the only thing separating one franchise location from the next.
  For a plain address result they are the same string and the second line is omitted.
- **The five free-text boxes are gone.** Not hidden, not collapsed behind "edit by hand" — absent.
  The card is one search box and the address it found. This is the part of 20260804 this ADR
  reverses: "the boxes stay editable afterwards" preserved exactly the hand-typed-address failure
  mode the lookup was introduced to end.
- **Picking a suggestion is the save.** No Save button. A shop that has clicked its own storefront
  out of a list has expressed the whole of its intent; a confirmation step adds a way to lose it and
  nothing else. The pick calls the same `saveAddressAction` with the same `FormData` and the same zod
  schema — a server action's arguments are attacker-controlled whatever calls it, so the
  hand-crafted-POST case and the honest one stay on one path.
- **A Remove control, because it is now the only way back to no address.** With the boxes gone,
  emptying them is no longer available, and a shop that mis-picked or stopped publishing a storefront
  needs a route to nothing. An all-empty save reports itself as *removed*, not *saved*.
- **Unconfigured says so in a sentence.** 20260804 made "no credentials" fall back to the five boxes.
  With no boxes to fall back to, the card states that lookup is not set up on this instance and still
  reads the stored address back — being unable to *change* an address is no reason to hide it. It
  does not render a search box that cannot answer.

## Consequences

- **A deployment with no `PLACES_AWS_*` credentials can no longer set a shop address from the UI.**
  That is the ordinary local and self-hosted case, and it is a real loss for self-hosters, who
  previously had five plain text boxes. The address remains settable by import (`src/db/import.ts`)
  and by seed. Recorded as a follow-up (`FU-20260811-self-hosted-address-entry`) rather than solved
  here, because the alternatives — a second hand-entry path, or a no-credential geocoder — are both
  larger than this change and neither is obviously right.
- **`Suggest` is priced like `Autocomplete`** (per request, plus the `Core` attributes), so the
  billing shape, the debounce, the three-character floor and `RATE_LIMITS.addressLookup` all carry
  over unchanged.
- **A shop can no longer correct a geocoder that is slightly wrong.** Under 20260804 the boxes were
  the escape hatch for a place whose street number Amazon has misfiled. Now the shop picks the
  nearest right answer or removes the address. This is the deliberate trade: the escape hatch was
  used far more often to enter a bad address than to fix one, and a wrong-but-consistent geocoded
  address still places the venue, where an invented one does not.
- **Fewer requests per address, not more.** The old card could be filled entirely by hand, so a
  careful shop spent nothing; but a hesitant one spent a request per keystroke *and* then typed the
  address anyway. One search that ends in a pick is the whole errand now.
- **The `address_removed` notice is new**, and both locale bundles carry it. The `address_invalid`
  notice no longer describes emptying a box, because there is no box.
- Suggestion text is still third-party content rendered into React children, where it is escaped by
  default; nothing here uses `dangerouslySetInnerHTML`, and nothing should. The query is still a
  partial business address and is still never logged.
- **A mocked provider client cannot tell you a request is malformed**, and this feature has now been
  broken three times by exactly that blind spot: a missing `AdditionalFeatures: ["Core"]`
  (2026-08-09), an out-of-range `MaxQueryRefinements` (2026-08-11), and a missing geographic anchor
  (2026-08-11, an hour later). Each time a test asserted the request and passed, because
  `{ send: vi.fn() }` accepts any object handed to it — the assertion proved the adapter sends what
  the adapter sends. Request-shape tests here are therefore written against the **API reference's
  stated constraints**, not against the value the code happens to pass, and every parameter carries
  a comment naming its documented range.
- **The API reference is not a sufficient source for this API's request rules**, which is the harder
  lesson and the reason the point above is not the whole fix. The anchor requirement appears nowhere
  in it: `BiasPosition`, `Filter.BoundingBox` and `Filter.Circle` are each marked "Required: No",
  no combination rule is stated, and the filtering guide documents no such constraint either. The
  only places it surfaces are the field list inside the rejection and the fact that *every*
  worked example in the developer guide passes a `BiasPosition`. Where the reference and the
  examples disagree about what a request needs, the examples are the better evidence.
- **A failure now names the field AWS refused.** `ValidationException` carries a `Reason` enum and a
  `FieldList` of `{ Name, Message }`; the log line takes `Reason` and the field `Name`s and never
  `Message`, which is prose AWS composes around the value it rejected — for `QueryText` that value is
  the shop's partly-typed address, the one thing this log may not carry. Before this, a malformed
  request logged a flat `"reason":"rejected"`, indistinguishable from every other bad request, which
  is how an out-of-range integer cost a production release.

## Alternatives considered

- **Keep `Autocomplete` and add a second `Suggest` call for names.** Two operations, two IAM actions,
  two bills, and a merge/dedupe step in the adapter — for a result set `Suggest` already covers.
  `Suggest` answers addresses as well as places; there is nothing `Autocomplete` finds that it
  misses, so the second call would buy only the risk of ranking one list against another.
- **Keep the five boxes, hidden behind an "enter it by hand" disclosure.** The gentler version, and
  the one that keeps self-hosters whole. Rejected because a hidden hand-entry path is still a
  hand-entry path: the mangled-address failure mode survives, and it survives in a place nobody
  looks at or screenshots, so it rots. The self-hosting loss is real and is recorded as
  `FU-20260811-self-hosted-address-entry` for a decision on its own terms rather than as a
  side effect of this one.
- **Keep the Save button, and have the pick merely fill the boxes.** The status quo. Rejected because
  the button can only be forgotten: a shop that has picked its own storefront from a list has already
  decided, and the one behaviour the button adds is an address that looks set on screen and is not
  set in the database.
- **Auto-save on every field edit instead of removing the fields.** Would have kept hand entry and
  still dropped the button. Rejected because per-keystroke saves on five free-text boxes write
  half-typed addresses to a published `PostalAddress`, and debouncing them re-invents the ambiguity
  the button had.
- **`SearchText` rather than `Suggest`.** It finds businesses too, but it is built for a *complete*
  query and returns richer, pricier results; the card types a keystroke at a time, which is the shape
  `Suggest` is for.
