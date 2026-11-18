# fee-comparison

This module owns the arithmetic behind the `/pricing` comparison and publishes its contract through `index.ts`.

## Owns

- `rules.ts`: what a month costs on FareHarbor and on DiveDay, counted the same way (software fee plus card processing, and an optional Booking.com commission), and what one sale moved off Booking.com saves.

## Does not own

DiveDay's own rate: it is the configured offer (`PRICING_*`, `src/features/pricing-flags`), passed in, never written here. Copy, sources and dates live in the marketing bundles beside the figures; every number below is an estimate with a named source.

## Invariants

Amounts are USD cents and integer math (`percentFeeCents`). Both columns add the same card processing to their percent (sources disagree on whether FareHarbor includes it; the page says which reading it uses). Each choice about Booking.com money leans toward the competitor.
