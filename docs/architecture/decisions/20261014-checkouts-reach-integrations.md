# 20261014-checkouts-reach-integrations — Online checkouts, tips and their refunds reach the shop's books

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

QuickBooks, Xero and Zapier heard only about orders (`enqueueOrderIntegrationEvent`, called from
`src/db/orders.ts`). A seat bought online is a `booking_checkouts` row and a tip is a `tips` row,
so most of a shop's card revenue never reached its accounting. [H-20261014-checkouts-reach-the-books](../../product/human-decisions/H-20261014-checkouts-reach-the-books.md)
chose one receipt per checkout and tips as income on their own line.

## Decision

**A completed checkout, a paid tip and a checkout refund each enqueue an integration event in the
same transaction that records them, on the existing outbox (`integration_events`), as
`order.paid` or `order.refunded` with `entityType` `checkout` or `tip`.**

- **One receipt per checkout**, not per seat. Lines are the fare (or the deposit), gear and
  pass-through fees, split over the settled amount net of tax by `allocateSettledTotal`; the
  customer is the party lead.
- **A tip is one `tip` line**, "Tip: <trip>", posted as income on its own line.
- **A checkout refund** is keyed by the checkout's running refunded total
  (`checkout:<id>:refund:<cents>`), so a DiveDay refund and a dashboard refund reconciled to the
  same total send once. A paid-after-close refund is not sent: nothing was sold on that checkout.
- **The ledger text names the source**: "DiveDay booking <id>", "DiveDay tip <id>"
  (`src/features/integrations/sale-reference.ts`); order text is unchanged.
- Rehearsal and incomplete checkouts send nothing.

## Alternatives considered

- **One receipt per seat** — a party of six would be six receipts against one card charge.
- **A tip folded into the fare line** — it is income the crew earned, not a fare; an accountant
  must see it apart.
- **New event types (`checkout.paid`)** — every subscriber would need a new subscription; the
  payload's `source` already tells them apart.

## Consequences

- A shop connected before this change receives checkouts from now on. Earlier ones are sent only
  when the **owner** asks, from Settings > Integrations, "Send earlier checkouts" (issue #2606):
  choose one connected provider and a start day in the shop's zone, preview the counts, confirm.
  The run queues the events oldest first through the same outbox, under the same idempotency keys,
  to that provider only. A candidate is skipped when any delivery of its event already exists for
  the shop's integration of that provider (a reconnect makes a new row, so the test is by provider),
  so a second run, or an overlap with live events, sends nothing twice. One run queues at most 500;
  the owner runs it again for the rest. There is no automatic backfill on connect: a closed period is
  the owner's to judge.
- Zapier subscribers see `entityType` `checkout` or `tip` on events they already receive.
