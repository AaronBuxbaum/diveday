# 20261009-stripe-reversals-reach-diveday — Record refunds and disputes made outside DiveDay from Stripe's webhooks

- **Status:** Accepted
- **Date:** 2026-10-09
- **Amends:** [20260719-stripe-connect-orders](20260719-stripe-connect-orders.md), which left
  disputes to H-07 and subscribed the Connect endpoint to invoice and account events only.

## Context

A shop's Stripe account is its own (Standard Connect), so an owner can refund a diver from the
Stripe dashboard, and a diver's bank can open a dispute, without DiveDay hearing of either. Until
now `charge.refunded` fell to the webhook's default arm on purpose: refunds moved only through
`refundOrder` and the cancellation refunds in `src/db/refunds.ts`. The result was an order still
reading `paid`, a Reports month overstating revenue, and QuickBooks/Xero/Zapier never receiving
the `order.refunded` the shop's books needed. A dispute was invisible until the money was gone.

## Decision

- **The Connect endpoint also subscribes to `charge.refunded`, `charge.dispute.created`,
  `charge.dispute.updated` and `charge.dispute.closed`.** Both name only a PaymentIntent, so the
  PaymentIntent is recorded as each payment settles: `orders.stripe_payment_intent_id` off
  `invoice.paid`, `booking_checkouts.stripe_payment_intent_id` off the session's completion. When
  neither has it, Stripe is asked once (`src/lib/payments/payment-sources.ts`: read-only list calls
  by PaymentIntent) and the answer is written back. Matching is always scoped to the event's own
  `account`.
- **A refund is reconciled to Stripe's cumulative `amount_refunded`, never applied as an event.**
  The delta `amount_refunded − refunded_cents` is computed under the row's lock and applied only
  upward. A refund DiveDay made has already raised `refunded_cents` (orders through
  `refundOrder`; checkouts through the new `booking_checkouts.refunded_cents`, which the
  cancellation refunds now count), so its echo adds nothing; replays and late, older events add
  nothing. While DiveDay's own refund of the same money is mid-flight (a fresh `started` refund
  intent, or one of any age that Stripe already confirmed) or the payment has not settled here
  yet, the webhook answers 503 and gives back its claim so Stripe delivers it again. A reversal
  still waiting 48 hours after its event goes to the stuck-operations queue (a `started` refund
  intent carrying the charge id) and the webhook answers 200.
- **One recording path.** An order moves through `applyOrderUpdate`, as every DiveDay refund does,
  so its booking payment, Reports and `order.refunded` move together; the trail code is
  `stripe_dashboard_refund`. A checkout covering one paid seat moves that seat; a party checkout's
  refund names no seat, so none is guessed at. It is counted on the checkout and put on the
  stuck-operations queue, and until a human reconciles it no DiveDay refund runs against any seat
  of that checkout (`needs_reconciliation`): the money may already be that seat's.
- **Stripe is asked only what it can answer.** The lookup runs with a key of the event's own mode,
  and a 4xx from it is read as "not DiveDay's" (logged, 200); only the network, a 429 or a 5xx is
  retried. A tip's PaymentIntent is recorded as its session completes, so a tip's refund or dispute
  is recognised without a lookup; neither is recorded yet.
- **Disputes are a mirror.** `payment_disputes` holds one row per Stripe dispute, ordered by the
  event's `created` time so a late `updated` never reopens a closed one; an `updated` stamped the
  same second as the close does not either. An undecided dispute is a
  Today row for owners and managers, and a banner on its order, with the amount and the evidence
  deadline. Nothing here moves money.

## Alternatives considered

- **`refund.created` per refund id** — would need every DiveDay refund path to share a ledger of
  refund ids; the cumulative figure dedupes by construction.
- **Proportional split of a party refund across seats** — invents an attribution Stripe does not
  hold.
- **Keep refunds app-only and document "don't refund in Stripe"** — the dashboard is the shop's
  own; it cannot be forbidden.

## Consequences

- The Connect webhook must list the four new events; `config/env-registry.mjs` says so.
- A refund that later **fails** at the bank (`charge.refund.updated`) is not handled: the books
  keep it. A lost dispute is not written onto the order either. Both are follow-ups if they occur.
- A party checkout's dashboard refund is counted on the checkout but on no seat, so Reports still
  shows those seats in full until staff mark the right one; it waits on the stuck-operations
  queue, and automatic refunds of that checkout's seats wait with it.
- DiveDay's own refund write still adds its amount rather than setting Stripe's cumulative
  figure: setting it would swallow a dashboard refund made in the same minutes, which then never
  reaches the books. A confirmed-but-unrecorded own refund is held off by the deferral instead.
- A tip's refund or dispute is not recorded anywhere.
- Leaving costs one migration: drop the PaymentIntent columns, `refunded_cents` and the table.
