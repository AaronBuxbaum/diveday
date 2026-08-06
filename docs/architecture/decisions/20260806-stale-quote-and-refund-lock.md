# 20260806-stale-quote-and-refund-lock — A pending checkout is a quote with an expiry date, and a refund is claimed locally before Stripe is asked

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

Two money paths were leaning on Stripe to catch a mistake DiveDay could catch itself, one on each
side of the till.

**Reusing a pending checkout (PAY-L2).** `startBookingCheckout` (src/db/checkouts.ts) hands back an
existing open session rather than minting a second one for the same seats — the right instinct, and
the reason a diver can abandon a tab and come back to it. But the only things it checked were that
the session was `pending`, had a URL, had not expired, and covered exactly this party. None of that
is a statement about *money*. Stripe holds a Checkout session's amounts for the whole life of the
session, so a session minted on Monday still charges Monday's fare on Friday. A shop that reprices a
trip, adds a deposit policy, or switches currency (docs ADR 20260731-shop-currency) leaves every open
session quoting a figure the shop is no longer asking for — and a diver who has just typed a
discount code gets handed the undiscounted session they abandoned an hour ago.

The confirmation panel made it worse in the quiet way: its "Finish paying" button is an `<a href>`
straight to `booking_checkouts.checkout_url` (`src/app/s/[shopSlug]/trips/[id]/page.tsx`), so it never
passes through `startBookingCheckout` at all. Fixing only the reuse branch would have left the
most-travelled path handing over the old figure.

**Refunding an order (PAY-L3).** `refundOrder` (src/db/orders.ts) read `orders.status` with a plain
`SELECT`, and if it said `paid`, called Stripe. Two staff taps — two tabs, a double-submitted form, a
retry after a slow response — both read `paid`, both minted their own payment-operation intent, and
therefore both carried their own distinct `Idempotency-Key`. The distinct key is deliberate and must
stay (PAY-C1: one payment intent covers a whole party, so two *genuine* refunds must never collapse
into one), which means Stripe's own replay protection cannot merge them either. The only thing
stopping the second reversal was Stripe rejecting an over-refund. Correct — but a network round trip's
worth of trust in a refusal we can make at home, and a refusal that arrives as an opaque `failed`
rather than as something staff can read.

## Decision

### A reused session must still quote today's charge

`startBookingCheckout` re-derives the charge on every reuse and compares it against what the stored
row was minted for (`stillQuotesCurrentCharge`): per-diver amount, deposit-or-full-fare,
party-and-gear total, and currency. A mismatch means the session is not reusable — it is retired
locally (`pending → expired`, the same terminal `rescheduleBooking` and
`markCheckoutPaymentFailedBySessionId` already write) and a fresh session is minted through the
ordinary path.

`retirePendingCheckoutIfRepriced` applies the same rule to a lone stored row, for the confirmation
panel. It compares only what a row alone can be compared on — the trip's own charge and the shop's
currency — because the party, the gear and the absence of a typed code are all facts about that row
rather than changes anyone made. With no live pending checkout the panel falls through to its "Pay
now" form, which mints a fresh session at today's price.

**The promotion comparison is one-directional, on purpose.** A caller that resolved a code is
compared strictly. A caller that resolved *nothing* is not evidence the discount went away:
`payForBooking` and the ready page's Pay button never resolve a code, because a diver returning to a
session they already hold has typed nothing new. Treating that silence as "the promo is gone" would
retire every discounted session on the diver's way back to it and re-mint at full price — this
ticket's own harm, pointed the other way.

Three invariants the re-mint keeps:

- **A different idempotency key.** A re-mint is a *different* attempt, so it mints its own intent and
  derives its key from that (`idempotencyKeyFor`, CR-005). Reusing the stale attempt's key would make
  Stripe replay the very session whose price is wrong.
- **Seats before money.** The bookings were committed before checkout ever ran (docs ADR
  20260721-checkout-at-booking). Retiring a quote touches no booking and no `booking_payments` row —
  it withdraws an offer, it does not reverse a payment. A Stripe failure on the re-mint degrades to
  pay-later exactly as a first-time failure does.
- **The stale session stays retired even when the re-mint fails.** It is retired *because* its figure
  is wrong, and a Stripe outage does not make it right.

Retirement is local only. The hosted session stays genuinely completable at Stripe until its own
longer expiry; what closes that loophole is `markCheckoutPaidBySessionId` refusing to settle a
checkout whose local status is no longer `pending` — the same mechanism, and the same limitation,
`rescheduleBooking` already documents.

### A refund is claimed under the order row's lock

`claimOrderRefund` opens a short transaction, takes `SELECT … FOR UPDATE` on the order row — the house
pattern from `createBookingRecord` (src/db/bookings.ts) and `applyOrderUpdate` — and does the whole
read-check-write inside it: status must be `paid`, no live `refund` intent may exist for this order,
then the intent is minted. Two callers serialize on the row, so the loser re-reads after the winner's
intent has committed and sees it.

The transaction commits **before** Stripe is called, never around it. It exists to order two local
decisions, not to hold a database lock across a network round trip — and that keeps
`startPaymentOperation`'s durability contract intact (CR-005): the intent is committed on its own,
ahead of the call it describes, so a crash mid-call still leaves it for `listStuckPaymentOperations`.

A claim is a guard for one Stripe round trip, never a permanent lock. An intent still `started` past
`STALE_AFTER_MS` belonged to a process that died and is ignored, exactly as `claimBookingsForCheckout`
treats an abandoned checkout claim.

`refundOrder` now returns a **code, not a boolean**: `refunded` | `not_found` | `not_paid` |
`in_progress` | `failed` (docs ADR 20260731-domain-layer-copy-leaks). `in_progress` earns its own
notice on both refund surfaces because the honest answer to a double-tapped button is "the first one
is still running", not "it failed" — which would send staff back to press it a third time.

**The local lock is a second gate, never a replacement.** Past the stale horizon, and for anything
this process cannot see, Stripe's own over-refund rejection is still the gate. Payment truth stays
Stripe's.

## Consequences

- A diver never pays a price the shop has stopped asking for, and never sees a figure on Stripe's
  hosted page that DiveDay did not compute for them at that moment. Nothing in the app renders a
  pending checkout's amount, so the hosted page is the only place the figure appears — a re-mint is
  therefore visible by construction, not a surprise at the card form.
- A repriced trip invalidates open sessions for divers mid-checkout. That is the point, but it means
  a shop that edits a price is retiring quotes; the log line `checkout.retired_stale_quote` is what
  makes that visible in production.
- Two refund taps cost one Stripe call instead of two, and the loser gets a readable refusal.
- **PGlite proves the logic; only real Postgres proves the lock.** The default test database is
  single-connection, so `FOR UPDATE` never blocks there and deleting it leaves the whole PGlite suite
  green. The PGlite tests pin the ordering (a second attempt driven re-entrantly from inside the
  first one's Stripe call), the refusal codes, and the stale-horizon self-heal. The lock's *presence*
  is asserted under genuine contention in `src/db/refunds.postgres.test.ts`, which runs on the
  real-Postgres job (docs ADR 20260806-real-postgres-ci-job) and fails loudly without the
  `FOR UPDATE`: five simultaneous taps become five reversals.
- `payment_operation_intents.started_at` is stamped by the database's clock, which `DIVEDAY_CLOCK`
  does not freeze, so `refundOrder` takes an optional `staleBefore` for tests — the same seam
  `claimBookingsForCheckout` already carries, and the same reason (`dbNow`, src/test/db.ts).

## Alternatives considered

- **Expire the stale session at Stripe (`POST /v1/checkout/sessions/:id/expire`).** Strictly better —
  it would close the "old tab completes a retired session" window rather than relying on
  `markCheckoutPaidBySessionId` to ignore the completion. Not taken here because it adds a method to
  `CheckoutProvider` and a network call to a path that must degrade cleanly when Stripe is
  unreachable; the local retirement is correct on its own and is what the reschedule path already
  does. Worth revisiting as its own slice.
- **Compare the promotion in both directions.** Rejected above: it re-mints at full price every time a
  returning diver taps "Finish paying".
- **Hold the refund transaction open across the Stripe call.** Would make the guard airtight against
  a crash mid-call, at the cost of holding a row lock for the length of a network round trip and
  breaking the intent-before-the-call durability contract. The stale horizon covers the crash case
  instead.
- **Leave PAY-L3 to Stripe.** Stripe does refuse the over-refund, so no money moves twice today. But
  the refusal costs a round trip, arrives as an opaque failure, and depends on an assumption about
  Stripe's behaviour that no test of ours holds. A local gate is cheaper, legible, and testable.
