# 20260803-booking-payment-events — Keep a local append-only money trail beside the mutable payment row

- **Status:** Accepted; amended 2026-11-03 (issue #2716): the entries are now the only store, and
  `booking_payments` is a view that folds them. See "Amendment 2026-11-03" below.
- **Date:** 2026-08-03

## Context

`booking_payments` is **one mutable row per booking**. `setBookingPayment` is a full-row upsert:
a refund overwrites the capture it reverses, a balance overwrites the deposit it completes, a staff
correction overwrites whatever was there before. Afterwards the row says `refunded` and nothing in
this database says money ever arrived, how much, in which currency, or against which Stripe object.

That is finding **DATA-M3** of the 2026-08-02 review ("no local money history"), and it is the
concrete half of open human decision **HD-14**: *invest in the local append-only trail now, or
accept Stripe as sole historical ledger until the first dispute.* This record is the first option,
taken deliberately.

The constraint that makes it cheap is already in place. Every writer of `booking_payments` in the
repo funnels through one function — `setBookingPaymentIfNotFinal` delegates to `setBookingPayment`,
and the checkout cascade, both order cascades, the automated cancellation refund and the staff
roster control all reach one of those two. There is exactly one place to write the trail from, and
it already holds a per-booking lock (`withBookingPaymentLock`) inside a transaction.

## Decision

**`booking_payment_events` records every transition of a booking's payment state, appended inside
the same transaction as the mutation that caused it.**

- One row per transition: `status`, `previous_status`, `amount_cents`, `currency`, `provider`,
  `provider_ref`, `operation`, `note`, `occurred_at`. Shaped like the repo's other append-only
  trails (`roll_call_events`, `activity_events`) — nothing is ever updated in place, the newest row
  restates the current state, and a correction is a further row.
- **Written in `setBookingPayment`, not at call sites.** The one funnel is the point: a future
  writer cannot forget the trail, because there is no way to mutate `booking_payments` without
  passing through it. The append happens under the same lock and in the same transaction as the
  upsert, so the two commit or roll back together.
- **`operation` is a pg enum, never a sentence** (`manual_mark`, `checkout_settled`,
  `order_settled`, `order_refunded`, `cancellation_refund`) — `src/db` returns codes and the UI
  picks the words ([20260731-domain-layer-copy-leaks](20260731-domain-layer-copy-leaks.md)). It
  defaults to `manual_mark`, which is what an unannotated write genuinely is: a staff member
  setting the status by hand. Every machine writer states its own.
- **`currency` carries no default.** An amount whose currency was guessed is not evidence
  ([20260731-shop-currency](20260731-shop-currency.md)); every writer already states it.
- **Transitions, not writes.** A write that changes nothing material appends nothing. The checkout
  webhook cascade deliberately re-runs on every redelivery to self-heal a partial write; without
  this rule the table would become a webhook delivery log rather than a money history. The
  comparison covers status, amount, currency, provider, provider reference and note — so a deposit
  topped up to a full fare *is* a transition even though the status word does not move.
- **Refusals append nothing.** `setBookingPaymentIfNotFinal` swallowing a lesser status over a
  refunded/waived row, or refusing to pay a cancelled booking, mutates nothing; a trail row there
  would claim a transition that never happened. Those refusals already emit `payment.refused_*` log
  lines.
- **Cascade delete on both foreign keys,** unlike `booking_payments`, whose rows the demo reaper
  and demo-schedule reset each clear by hand from their own topologically-sorted lists. A trail row
  describes exactly one booking of one shop and has no meaning once that booking is gone; those two
  hand-maintained lists are precisely where a forgotten child surfaces as an FK violation mid-reap.
- **One index**, `(shop_id, booking_id, occurred_at)`, backing the one query it serves —
  `listBookingPaymentEvents`, one booking's history newest first, shop-scoped so the tenant
  predicate is index-served.

## Alternatives considered

- **Accept Stripe as the sole historical ledger (HD-14's other option)** — free today, and correct
  right up until the first dispute, a Connect disconnection, a shop that switches processors, or a
  refund conversation about a counter-cash payment Stripe never saw. Reconstructing "what did this
  diver actually pay?" would mean a live API call per booking against an account we may no longer
  have a token for. Rejected, but the ADR exists so the trade is recorded rather than assumed.
- **Version `booking_payments` in place (an `is_current` flag, or history-by-insert)** — turns
  every read of the current state into a "newest row" query, and every existing consumer
  (`paymentsByBooking`, readiness gating, the roster) would have to learn it. The current row is
  read on hot paths; the history is not.
- **Write the trail at each call site** — five call sites today, and the sixth is the one that
  forgets. The funnel already exists; using it is strictly safer.
- **Append on every write, including no-op replays** — simpler comparison, but a Stripe webhook
  storm turns a money ledger into a delivery log, and the delivery log already exists
  (`stripe_webhook_events`).
- **A new `checkout_status` value / a separate refusal log** — see
  [20260803-async-payment-failed](20260803-async-payment-failed.md) for the first; the second is
  covered by the existing structured logs.

## Consequences

Makes easy: reconstructing a booking's money history offline, answering a chargeback without a
Stripe round-trip, and auditing what a replayed webhook actually changed. The trail is written
under the same lock that already serializes payment writes, so it inherits their concurrency
guarantees rather than inventing new ones.

Makes harder: one extra `SELECT` and (on a real transition) one extra `INSERT` per payment
mutation, inside a lock that other payment writes queue behind. Both are single-row, primary-key /
unique-index operations on a table with one index.

### What this deliberately did not do

- **It does not surface the trail anywhere in the UI.** No staff page reads
  `listBookingPaymentEvents` yet. The table is evidence first; a diver-record "payment history"
  panel is a separate slice, and shipping the ledger before the screen is the right order — a
  screen can be added over a full history, but history cannot be added retroactively.
- **It does not backfill.** Bookings settled before this migration have no events. Their current
  row is all there is, exactly as before.
- **It did not export.** `src/db/export.ts` gained `booking_payment_events.csv` shortly after this
  record, and the several-tables-at-once decision it deferred was made on 2026-08-06 by
  [20260806-export-operational-records](20260806-export-operational-records.md).
- **It does not record refusals, or Stripe-side events that never touched a booking's payment
  state** — a failed async payment, an expired session. Those live in `stripe_webhook_events` and
  the structured logs.
- **It does not make `booking_payments` immutable.** The current row is still a mutable upsert;
  this is a trail beside it, not a replacement for it.
- **It does not decide how long the trail is kept.** That is
  [20260803-append-only-retention](20260803-append-only-retention.md), whose window values are
  HD-11's to set.

### Escape hatch

If the write cost ever shows up on the booking path, the append can move behind the same
`db.transaction` the caller already opens without changing the table (it is already there today) —
or, at the cost of the guarantee this record exists for, become an after-commit write. Dropping the
table entirely is one migration and deleting one function; nothing reads it on a hot path.

## Amendment 2026-11-03: the entries are the store, `booking_payments` is their fold

Issue #2716 (codebase review idea L06-1, Aaron chose "Build all three" for the payments group).

The trail had become the better record of the two: every write already went through the one funnel,
every transition already appended a row, and the newest row already restated the current state. The
mutable row was a second copy that could only drift from it, and a refund still overwrote it in place.

- **`booking_payments` is a view**, `select distinct on (shop_id, booking_id) … from
  booking_payment_events order by shop_id, booking_id, seq desc`, with the old table's name and its
  columns except `created_at`. Its `updated_at` is the newest entry's `occurred_at`. Every reader
  (the roster, readiness's `PAYMENT_CLEARED` gate, Reports, refunds) keeps reading it unchanged, and
  a release still serving during the deploy keeps reading it too. Nothing can write it.
- **`setBookingPayment` only appends.** Under the same per-booking lock it reads the fold, compares,
  and appends one entry when something material changed; it returns the new state, or the unchanged
  one. The comparison now also covers `method` and `recorded_by_person_id`: with no mutable row, a
  change the trail skipped would be a change lost, so the same mark made by another staffer is an
  entry of its own.
- **`seq` (bigserial) orders the entries**, not `occurred_at`. The app clock can give two writes in
  one transaction, or under a pinned `DIVEDAY_CLOCK`, the same instant; the fold must never tie.
  The index is now `(shop_id, booking_id, seq)`, and leading with `shop_id` in the `distinct on`
  lets a reader's shop predicate reach it.
- **A replay no longer moves `updated_at`.** It used to bump the mutable row on every redelivery;
  now the time is when the state was last really reached, which is what the owed-refunds list and
  the month's report lines meant by it.
- **Erasure scrubs `note` on the entries,** which also scrubs the current state, since the state is
  the newest entry.
- **Export** reads the entries once: `booking_payment_events.csv` in write order, and the bookings
  file's `payment_*` columns from the newest entry per booking.
- **No backfill** (H-20260815-no-legacy): bookings whose state lived only on the dropped table
  read as unpaid.

The rest of #2716 (one `money_entries` table with components and directions, tips, orders and
checkouts as entries, one monthly report grouped by component) is not part of this amendment.

