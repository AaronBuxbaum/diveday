# 20261102-a-redemption-is-a-completed-checkout — A shop code's use is counted from checkouts, not a table of its own

- **Status:** Accepted
- **Date:** 2026-11-02
- **Supersedes:** "Redemptions are recorded, not counted from" in [20260729-shop-promo-codes](20260729-shop-promo-codes.md)

## Context

`shop_promo_redemptions` held one row per completed checkout that spent a shop-wide code: the code, the
checkout, what Stripe settled, and when. Every one of those facts is already on the checkout:
`booking_checkouts.promo_code_id`, `settled_total_cents` and `completed_at`. A trip's last-minute deal
has no such table and is counted from completed checkouts already (`src/db/promo-caps.ts`), so the cap
check had two answers to one question. Issue #2720 (the first, storage-only slice of "a Deal is one
row"; its recipients table was already gone).

## Decision

A redemption is a `booking_checkouts` row with `status = 'completed'` and the code's id. "Times
redeemed", the shelf a code sits on, the cap check and "what each code took off" all count those rows
(`redeemedBy` in `src/db/shop-promos.ts`). `shop_promo_redemptions` and its export file
`shop_promo_redemptions.csv` are deleted; `booking_checkouts.csv` already carries the code id, the
settled total and the completion time.

A checkout completes once (the paid transition is a status change under the checkout's lock), so a
replayed webhook cannot count a use twice, which is the property the unique index on `checkout_id`
used to give.

## Consequences

- One count for shop codes and trip deals; the cap check no longer sums a table and a status.
- `amount_charged_cents` is gone as a column. With no settled figure from Stripe the diver's
  `booking_payments` amount, net of the code, still records what was collected.
- Not done here: the rest of "One Deal" (one `deals` table, the Stripe mint as an attempt, both stored
  status enums) is a larger change and an owner call on the roadmap.

## Alternatives considered

- **Keep the table as an audit trail.** Rejected: every column restates the checkout, and a second
  place to write on completion is a second place to disagree.
- **Add `amount_charged_cents` to the checkout.** Rejected: `settled_total_cents` is that figure
  whenever Stripe reports one, and the payment rows hold it when it does not.
