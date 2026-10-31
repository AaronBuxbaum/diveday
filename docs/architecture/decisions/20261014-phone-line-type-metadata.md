# 20261014-phone-line-type-metadata — Use libphonenumber-js's mobile metadata to gate counter QR texts

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

The counter QR texts a walk-in their release when they give only a phone, and the shop pays per
message (issue #2092). Its gate (`anonymousTextRecipient`, `homeNumberingArea` in
`src/lib/phone-line-type.ts`) keeps the recipient in the shop's own country by calling code and,
for `+1`, by the country the same metadata assigns the number to (issues #2151, #3249; it was a
hand-kept area-code table until 2026-10-31). Inside a non-NANP country that is not enough: a UK 09 number or a
Spanish 80x/90x number counts as home, so the shop pays premium rates, and a landline never shows
the text (issue #2289). Aaron decided on 2026-10-13 to classify line type with
libphonenumber-style metadata, text only mobile or fixed-line-or-mobile numbers, and otherwise not
text. The path is anonymous and public, so the gate must fail toward not sending.

## Decision

- Add `libphonenumber-js` 1.13.14 (MIT) as a runtime dependency, imported only as
  `libphonenumber-js/mobile`: the smallest build that knows line types (about 100 kB of metadata
  against 156 kB for `max`). It answers `MOBILE` for a mobile number and for a NANP number, whose
  landline and mobile ranges coincide, and nothing for any other line.
- `canReceiveText` (`src/lib/phone-line-type.ts`) accepts `MOBILE` or `FIXED_LINE_OR_MOBILE` and
  refuses everything else, unknown included. `selfRegistrationReleaseDelivery` asks it after the
  country gate and before any rate-limit bucket, so a refused number never spends the shop's daily
  text cap; the refusal is `not_mobile`, the registration is kept, and the shop sends the release
  itself, as for every other refusal.
- The check lives in its own module, read only on the server. `phone.ts` stays dependency-free
  because the browser reads its calling-code table (`src/lib/forgiving-fields.ts`).
- `homeNumberingArea` (same module) admits a `+1` number only when the parsed number is valid and
  its resolved country equals the shop's. The `mobile` build resolves no country for premium
  900/976, toll-free 8XX or personal 5XX ranges, and resolves territories (PR, GU, VI, Jamaica, the
  Dominican Republic) to their own codes, so all of those refuse and so does anything unplaceable.
  This replaced the area-code table (issue #3249); Aaron accepted on 2026-10-31 that US 738/748
  and Canada 273 now pass, which the table refused.
- `homeNumberingArea` and `anonymousTextRecipient` live in server-only modules
  (`phone-line-type.ts`, `self-registration-delivery.ts`). `self-registration.ts` and `phone.ts`
  are imported by client components and must not import the metadata.
- Staff-initiated texts are not gated: a person chose that recipient.

## Alternatives considered

- **A checked-in range table for the home countries in use (UK 09, ES 80x/90x)** — no dependency,
  but it lists premium ranges rather than mobile ones, so every new shop country and every
  regulator's range change is a silent pass until someone notices a bill.
- **The `max` metadata** — names every line type, but the gate needs only "mobile or not", and it
  is half again the size.
- **A carrier lookup API at send time** — exact, but a paid external call on an anonymous path,
  with its own outage mode.

## Consequences

- Line types are as current as the installed metadata. The package republishes metadata roughly
  every two weeks; a stale copy refuses a newly opened mobile range (fails safe) and could pass a
  newly reassigned premium one, so updates to this package are taken like any other.
- `canReceiveText` says nothing about a `+1` line (landline and mobile coincide), so `+1` premium
  exclusion rests on `homeNumberingArea`'s country resolution, as fresh as the installed metadata:
  a stale copy refuses a newly assigned code (fails safe).
- Leaving is cheap: one function and one import. Revisit if a provider's own line-type lookup
  becomes free at send time, or if per-country custom metadata (libphonenumber's generator) is
  wanted to cut the size further.
