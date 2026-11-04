# 20261103-a-deal-is-one-row — A shop-wide code and a last-minute deal are one `deals` row

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amends:** [20260727-last-minute-fill-promos](20260727-last-minute-fill-promos.md) and [20260729-shop-promo-codes](20260729-shop-promo-codes.md) (their two tables)

## Context

A shop mints two kinds of Stripe promotion code: a shop-wide code staff write
(`shop_promo_codes`) and a last-minute deal sent for one departure
(`trip_last_minute_promos`). Same Stripe mechanism and columns, yet two tables, two status enums,
and two columns on every checkout and payment intent. The 2026-09-18 review (idea L06-3,
issue #2720) proposed one row. The redemption and recipient tables it also named were already gone
([20261102-a-redemption-is-a-completed-checkout](20261102-a-redemption-is-a-completed-checkout.md)).
This is the storage half only; the screens do not change.

## Decision

1. **One table, `deals`.** `trip_id` null is a shop-wide code; set, a last-minute deal. The
   columns are the union of the two tables. `deals_trip_shape` holds what a last-minute deal never
   has: a start date, a scope other than `all`, a description, or the `disabled` status. Its
   expiry is required. `deals_discount_range` keeps both ranges (1..100 for a code, 5..90 for a
   deal). One code per shop across both kinds, as Stripe holds them on one account.
2. **One status enum, `deal_status`** (`pending`, `active`, `disabled`, `failed`). A last-minute
   deal's old `sent` is `active`.
3. **A checkout and a payment intent name one `deal_id`.** The resolution order stays: the trip's
   deal, then the shop's code. `booking_checkouts_tip_shape` names `deal_id`.
4. **`interests.promo_id` points at `deals`.**
5. **The export keeps its files.** `shop_promo_codes.csv` and `trip_last_minute_promos.csv` are
   `deals` split by `trip_id`, and `booking_checkouts.csv` keeps `promo_code_id` and
   `trip_promo_id`, written from `deal_id` by the deal's kind. The trip file's status reads
   `active` where it read `sent`.

## Alternatives considered

- **Two tables behind a view.** Writers still pick a table; checkouts keep two columns.
- **One `deals.csv`.** Changes a shop's export for a change no screen shows.
- **Drop the old tables now.** The serving release reads them during the deploy.

## Rollout (expand/contract)

Every row keeps its id, so the copy is a plain insert and a reference to an old row is a reference
to its deal. The two old tables, their enums and the four old columns stay declared as `retired*`
for one release, because the release serving during the deploy still reads and writes them.
Triggers forward that release's writes (a code minted, switched off or deleted, a deal sent, a
checkout or reservation naming an old column) onto `deals` and `deal_id`. The next release drops
the tables, enums, columns, triggers and functions.

Known gap while both releases serve: the bridge forwards the old release's writes into `deals`,
not the reverse. A shop code switched off on the new release still applies on the old one (it
reads `shop_promo_codes.status`, and switching off is local, not at Stripe), and the old release
does not see uses the new one records in `deal_id`, so a capped code can overshoot its cap by the
uses made in that window. Reverse triggers are not worth it before the pilot.

Before production applies the copy, check that no shop's staff code equals one of its generated
last-minute codes, which would fail the insert on `deals_shop_code_unique` (the copy's
`ON CONFLICT ("id")` does not cover it): `select shop_id, code from shop_promo_codes intersect
select shop_id, code from trip_last_minute_promos;` must be empty (generated codes look like
`SAVE25-A1B2C3`).

## Consequences

- Readers say which kind they mean with `trip_id` (`shopWide` in `src/db/shop-promos.ts`, and
  `TripLastMinutePromo` in `src/db/trip-promos.ts`, which narrows a row to a deal with a trip).
- The review's further steps (a deal's state derived from its window, cap and switch rather than
  stored; the Stripe mint as a payment attempt) are not taken here.
