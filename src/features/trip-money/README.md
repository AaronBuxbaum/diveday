# trip-money

This module owns Wrapped up's Money card: what one departure collected, what of it was rental gear, and what its seats still owe. It publishes its contract through `index.ts`.

## Owns

- `rules.ts`: the arithmetic over each seat's current payment, balance and rental money.
- `store.ts`: the shop-scoped reader over existing payment, checkout and order rows.

## Does not own

Payment state, balances and refunds stay in their own modules (`payment-marks`, `src/db/payments.ts`); this module only reads them. Reports' monthly figures stay in `reporting`.

## Invariants

Reads only; no new state. Collected counts the payment states Reports counts (`paid`, `deposit_paid`, `partly_refunded`) at what the shop still holds. Owed and Rentals count live seats only; rental money is net of its share of any refund on its checkout or order, and is counted by guest. Money in a currency other than the shop's is never added to its sums.
