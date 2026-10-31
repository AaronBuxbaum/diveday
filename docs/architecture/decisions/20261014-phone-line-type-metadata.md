# 20261014-phone-line-type-metadata — Use libphonenumber-js's mobile metadata to gate counter QR texts

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The counter QR texts a walk-in their release when they give only a phone, and the shop pays per
message (issue #2092). Its gate keeps the recipient in the shop's own country by calling code and,
for `+1`, by the country the metadata assigns the number to (issues #2151, #3249; it was a
hand-kept area-code table until 2026-10-31). A calling code alone is not enough: a UK 09 or
Spanish 80x/90x number counts as home, so the shop pays premium rates, and a landline never shows
the text (issue #2289). Aaron decided on 2026-10-13 to classify line type with
libphonenumber-style metadata and text only mobile or fixed-line-or-mobile numbers. The path is
anonymous and public, so the gate must fail toward not sending.

## Decision

- Add `libphonenumber-js` (MIT) as a runtime dependency, imported only as
  `libphonenumber-js/mobile`, the smallest build that knows line types.
- `canReceiveText` (`src/lib/phone-line-type.ts`) accepts `MOBILE` or `FIXED_LINE_OR_MOBILE` and
  refuses everything else, unknown included. `selfRegistrationReleaseDelivery` asks it after the
  country gate and before any rate-limit bucket, so a refused number never spends the daily cap;
  the registration is kept and the shop sends the release itself.
- `homeNumberingArea` admits a `+1` number only when it parses as valid and resolves to the shop's
  country. Premium 900/976, toll-free 8XX, personal 5XX and territories (PR, GU, VI, Jamaica, the
  Dominican Republic) resolve elsewhere or nowhere, so they refuse. Aaron accepted on 2026-10-31
  that US 738/748 and Canada 273 now pass.
- `homeNumberingArea` and `anonymousTextRecipient` live in server-only modules. `phone.ts` and
  `self-registration.ts` are imported by client components and must not import the metadata;
  `check:architecture` enforces it.
- Staff-initiated texts are not gated: a person chose that recipient.

## Alternatives considered

- **A checked-in range table**: lists premium ranges, so every range change is a silent pass.
- **The `max` metadata**: half again the size for types the gate does not need.
- **A carrier lookup API at send time**: a paid external call on an anonymous path.

## Consequences

- Line types are only as current as the installed metadata, so updates to this package are taken
  like any other. A stale copy refuses a newly opened range (fails safe).
- Metadata lag is bridged by `LAGGING_NANP_AREA_CODES`, deleted entry by entry as the package
  catches up.
- Leaving is cheap: one function and one import.
