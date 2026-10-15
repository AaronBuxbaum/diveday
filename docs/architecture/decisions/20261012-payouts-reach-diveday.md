# 20261012-payouts-reach-diveday — Record Stripe payouts so Reports meets the bank statement

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** [20261009-stripe-reversals-reach-diveday](20261009-stripe-reversals-reach-diveday.md),
  which subscribed the Connect endpoint to refunds and disputes and left payouts out.

## Context

An owner reconciles a bank statement against payouts, not against bookings. DiveDay had three
totals (Orders, Reports' net revenue, Close-out's "What today made") and no line saying what Stripe
actually paid into the bank, when, or for which days; the only "payout" anywhere was the Connect
account's `payouts_enabled` flag. Stripe's fees were nowhere at all. (UX review 2026-10-11, items
16 and 17.)

## Decision

- **The Connect endpoint also subscribes to `payout.paid`, `payout.failed` and `payout.canceled`.** One
  `stripe_payouts` row per Stripe payout, upserted by `recordStripePayout`
  (`src/db/payouts.ts`). The shop is the one holding the event's own `account` in
  `shop_stripe_accounts`; nothing in the payout body chooses it, and a row never moves to another
  account. Events are ordered by their `created` time, and `failed` and `canceled` are terminal: a `paid`
  delivered after either (late or stamped later) changes nothing. A canceled payout is shown on
  Reports as canceled and never on the Orders index's paid or failed lines; `payout.updated` is
  not subscribed (nothing it carries is shown).
- **What a payout carried is asked of Stripe once, at webhook time, never at render.** A paid
  automatic payout is itemized with `GET /v1/balance_transactions?payout=…` on the connected
  account (`src/lib/payments/payout-summary.ts`, read-only, the platform key of the event's own
  mode). The earliest and latest `created` of the money it carries become "covering Sep 27 to
  Oct 1", and the sum of `fee` becomes Stripe's fees on it. A list longer than twenty pages, a 4xx or a key of the other mode records the
  payout without either, which pages read as "Stripe did not say". The network, a 429 or a 5xx
  defers the event (503, claim released) so Stripe delivers it again.
- **Pages read the stored row.** Reports lists the month's payouts by arrival day and adds the
  month's Stripe fees, summed from those payouts; the Orders index shows the newest paid payout and
  a warning when one failed after it. Both are owner and manager reads.
- **A manual or instant payout** is read for its own balance transaction
  (`balance_transactions?source=po_…`), because Stripe will not itemize it: its fee counts toward
  Reports' fee line and its line has no "covering" clause, since the span cannot be known.

## Alternatives considered

- **Ask Stripe when the page renders** — every Reports view would wait on Stripe, and an outage
  would blank the owner's month.
- **Record every balance transaction** — a second ledger of Stripe's, for two figures.
- **Derive the span from DiveDay's own payments** — DiveDay does not know Stripe's settlement
  schedule; the span would be a guess printed as a fact.

## Consequences

- A shop must have the two events enabled on the Connect endpoint (`config/env-registry.mjs`).
- A payout made before this shipped is never backfilled (H-49).
