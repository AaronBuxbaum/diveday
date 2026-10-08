# 20261008-work-order-follow-up — Tell the customer, bill through orders, and remind before service is due

- **Status:** Accepted (2026-10-08)
- **Date:** 2026-10-08

Builds on [20261008-gear-work-orders](20261008-gear-work-orders.md), which put repair work orders on
the bench and named this as the next slice: the customer hears when a ticket is ready, the shop
can bill it, and a customer's piece gets a reminder before its service comes due.

## Context

A work order records the work. On its own it does not reach the customer: the shop still phones
to say a regulator is ready, writes the bill somewhere else, and remembers next year's service from
a paper card. The product owner settled two points on 2026-10-08:

- **Billing goes through Stripe by reusing `createOrder`**
  ([20260719-stripe-connect-orders](20260719-stripe-connect-orders.md)). There is never a second
  billing path.
- **Service reminders send automatically**, about a month before each customer piece's due date,
  with an opt-out per piece.

Constraints a lower-context agent must not miss:

- **Only customer gear.** A ticket on one of the shop's own units has nobody to tell and nobody to
  bill, and the shop's fleet never gets a reminder.
- **Layer 1's tables are not altered.** Everything here lives in three tables of its own, so the
  bench's schema can keep moving without a migration conflict.

## Decision

**Three tables, all `shop_id`-scoped and outside the retention prune.**

- `customer_gear_notices` is one row per message the bench sent, of two kinds:
  - **Ready for pickup**: claimed on the `work_order_events` row that moved the ticket to ready
    (unique `customer_gear_notices_ready_once`). One message goes per ready transition, and a
    ticket moved back and to ready again earns another. A staff resend is its own row with no
    event.
  - **Service due**: claimed on (piece, clock, due date) (unique
    `customer_gear_notices_reminder_once`). A new due date earns a new reminder, and a cylinder's
    visual and hydro dates are separate reminders.

  Each row is claimed *before* the send and settled after: sent, failed, not configured, no
  contact, or opted out. Two passes, or two staff tapping Resend, can never send twice. Both
  notification kinds are non-queueable, so the row stays truthful about what happened.
- `work_order_bills` links a ticket to the order its bill raised (`order_id` unique). Send the bill
  builds one order from the ticket's lines through `createOrder`, so the order's own checks apply:
  owner or manager, a payable Stripe account, line and currency limits, a customer email. The link
  is written under a row lock. A second open bill is refused, a void or uncollectible one allows
  another, and a link that loses a race voids its own order at Stripe. With no account connected,
  the ticket shows the total and says it is collected at the counter, with no button.
- `customer_gear_reminder_settings` is the per-piece opt-out, written from the diver record.

**The channel picker decides how a message goes.** Email when the customer has an address,
otherwise the courtesy text (WhatsApp where the shop has a sender, else SMS with its stop line). The
reminder is commercial: it carries the courtesy-email unsubscribe and honours that opt-out. When
email is off and there is no phone, nothing is sent and no row is written. Reminders ride the
hourly trip-reminders cron, so each shop's daytime send window applies. They skip a piece that is
on an open ticket right now. **Which dates a piece has is read by one function**,
`customerGearDueDates` in `src/lib/work-order-follow-up.ts`.

**Today gains two rows for the bench.** A ticket past its promised day and not yet ready (warning),
and a ticket ready for seven days or more and not collected (neutral). Both go to every staff role,
like the register's rows.

## Alternatives considered

- **A `notified_at` column on `work_orders`.** It would alter layer 1's table mid-flight. It also
  cannot tell one ready transition from the next, or a resend from the automatic message.
- **An invoice table of the bench's own.** Orders already own money; a second place to raise a
  charge is how a shop double-bills.
- **A nightly reminder cron of its own.** It would have needed a new route, an infra schedule, and
  its own send-window logic. The hourly trip-reminders pass already has all three.
- **A reminder for the shop's fleet.** The register's service clocks already put those on Today,
  and a message about the shop's own cylinder has no recipient.

## Consequences

A customer hears from the shop when their gear is ready and before its next service, and a bench
bill is an ordinary order: refunds, receipts and the Orders index all work unchanged. The bench now
depends on a customer having an email for the bill; staff see why there is no button when they do
not.

Revisit if a shop wants the customer to approve an estimate before work starts (a status and a
token page), or wants reminders on a different lead time (`SERVICE_REMINDER_LEAD_DAYS` is one
constant today).
