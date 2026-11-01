# 20261012-payouts-reach-diveday — Record Stripe payouts so Reports meets the bank statement

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** [20261009-stripe-reversals-reach-diveday](20261009-stripe-reversals-reach-diveday.md),
  which subscribed the Connect endpoint to refunds and disputes and left payouts out.

## Context

An owner reconciles a bank statement against payouts, not against bookings. DiveDay had no line
saying what Stripe paid into the bank, when, or for which days, and Stripe's fees were nowhere.
(UX review 2026-10-11, items 16 and 17.)

## Decision

- **The Connect endpoint subscribes to `payout.paid`, `payout.failed` and `payout.canceled`.** One
  `stripe_payouts` row per Stripe payout, upserted by `recordStripePayout` (`src/db/payouts.ts`).
  The shop is the one holding the event's own `account`; nothing in the body chooses it, and a row
  never moves to another account. Events are ordered by `created`; `failed` and `canceled` are
  terminal, so a `paid` after either changes nothing. `payout.updated` is not subscribed.
- **What a payout carried is asked of Stripe once, after the webhook has answered, never at
  render** (2026-10-15, issue #2464). `recordStripePayout` writes the row and the route answers 200;
  `summarizeStripePayout` then runs from Next `after()`. A paid automatic payout is itemized with
  `GET /v1/balance_transactions?payout=…` on the connected account (read-only, the event's mode key): the earliest and latest `created` become "covering Sep 27 to Oct 1", the
  sum of `fee` becomes Stripe's fees on it. The write is conditional on the row still being paid
  and unsummarized, so a duplicate run asks and writes nothing twice. A list past twenty pages, a
  4xx or a key of the other mode records the payout without either ("Stripe did not say"); the
  network, a 429 or a 5xx retries after 2 s and 8 s, then leaves the payout unsummarized and logs
  an error. A resent event summarizes it then.
- **A manual or instant payout**, which Stripe will not itemize, is read for its own balance
  transaction (`balance_transactions?source=po_…`): its fee counts toward Reports' fee line and its
  line has no "covering" clause.
- **Pages read the stored row.** Reports lists the month's payouts by arrival day and the month's
  fees, summed from those payouts; the Orders index shows the newest paid payout and a warning when
  one failed after it.
- **Fees stay on the payout month** (issue #2462). They match the bank statement, and the copy says
  so. Attributing a fee to the charge month needs a Stripe read per payment and a column on
  payments, until a bookkeeper asks.

## Alternatives considered

- **Ask Stripe when the page renders** — an outage would blank the owner's month.
- **Hold the webhook open on the page walk, answering 503 to retry** — the first design: up to
  twenty GETs inside Stripe's delivery, and a payout over the cap cost the delivery, not only the
  figure.
- **Derive the span from DiveDay's own payments** — the settlement schedule is Stripe's.

## Consequences

- A shop must have the three events enabled on the Connect endpoint (`config/env-registry.mjs`).
- A payout made before this shipped is never backfilled (H-20260815-no-legacy).
