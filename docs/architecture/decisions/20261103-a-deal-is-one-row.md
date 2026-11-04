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
to its deal. The two old tables, their enums and the four old columns stayed declared as `retired*`
for one release, because the release serving during the deploy still read and wrote them.
Triggers forwarded that release's writes (a code minted, switched off or deleted, a deal sent, a
checkout or reservation naming an old column) onto `deals` and `deal_id`. With no users to lose, the
tables, enums, triggers and functions were dropped in the next change (#3778); the four columns
follow once the previous release no longer declares them (#3866).

Known gap, deploy window only: the bridge forwards the old release's writes into `deals`, not the
reverse. A code switched off on the new release still applies on the old one, and a capped code can
overshoot its cap by the uses made meanwhile. Reverse triggers are not worth it before the pilot.
The copy fails if a staff code equals one of its shop's generated last-minute codes; generated codes
look like `SAVE25-A1B2C3`. A deal's departure must belong to the deal's own shop
(`deals_shop_trip_fk`).

## Consequences

- Readers say which kind they mean with `trip_id` (`shopWide` in `src/db/shop-promos.ts`, and
  `TripLastMinutePromo` in `src/db/trip-promos.ts`, which narrows a row to a deal with a trip).
- The review's further steps (a deal's state derived from its window, cap and switch rather than
  stored; the Stripe mint as a payment attempt) are not taken here.
